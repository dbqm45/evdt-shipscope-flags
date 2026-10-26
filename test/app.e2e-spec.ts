import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types.js";
import { AppModule } from "./../src/app.module.js";
import { configureApp } from "./../src/app.setup.js";
import { loadState, seedState } from "./../src/db/load-state.js";
import type { PrismaClient } from "./../src/generated/prisma/client.js";
import { resetDatabase, testPrisma } from "./db.js";

describe("API (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;

  const SDK_TOKEN = "e2e-sdk-token";
  const sdkGet = (path: string) => request(app.getHttpServer()).get(path).set("Authorization", `Bearer ${SDK_TOKEN}`);

  beforeAll(async () => {
    process.env.SDK_TOKEN = SDK_TOKEN;
    prisma = testPrisma();
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleFixture.createNestApplication());
    await app.init();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await loadState(prisma, seedState());
  });

  afterAll(async () => {
    await app.close();
    delete process.env.SDK_TOKEN;
    await prisma.$disconnect();
  });

  it("GET /api/health reports the database as reachable", () => request(app.getHttpServer()).get("/api/health").expect(200, { status: "ok", database: "ok" }));

  it("GET /api/flags returns the stored flags", async () => {
    const res = await request(app.getHttpServer()).get("/api/flags").expect(200);
    expect(res.body.map((f: { key: string }) => f.key)).toEqual(seedState().flags.map((f) => f.key));
  });

  it("PATCH /api/flags/:key/environments/:env changes the state, and 409 when the rules block it", async () => {
    const flag = seedState().flags.find((f) => f.environments.test.enabled && !f.environments.qa.enabled && !f.dependsOn)!;
    await request(app.getHttpServer()).patch(`/api/flags/${flag.key}/environments/prod`).send({ enabled: true }).expect(409);
    const patched = await request(app.getHttpServer()).patch(`/api/flags/${flag.key}/environments/qa`).send({ enabled: true, actor: "e2e" }).expect(200);
    expect(patched.body).toMatchObject({ ok: true, flag: { key: flag.key, environments: { qa: { enabled: true, updatedBy: "e2e" } } } });

    const sdk = await sdkGet("/api/sdk/flags?env=qa").expect(200);
    expect(sdk.body).toMatchObject({ env: "qa", flags: { [flag.key]: true } });
  });

  it("GET /api/sdk/flags with the shared token: 401 without or with a wrong one, and 401 once the server has none", async () => {
    await request(app.getHttpServer()).get("/api/sdk/flags?env=prod").expect(401);
    await request(app.getHttpServer()).get("/api/sdk/flags?env=prod").set("Authorization", "Bearer wrong").expect(401);
    await sdkGet("/api/sdk/flags?env=prod").expect(200);

    delete process.env.SDK_TOKEN;
    try {
      await sdkGet("/api/sdk/flags?env=prod").expect(401);
    } finally {
      process.env.SDK_TOKEN = SDK_TOKEN;
    }
  });

  it("a registered service reads only its own flags with its credential, which records its check-in", async () => {
    const server = app.getHttpServer();
    const flag = seedState().flags[0];
    const registered = await request(server).post("/api/services").send({ key: "billing-api", actor: "e2e" }).expect(201);
    expect(registered.body).toMatchObject({ service: { key: "billing-api", hasCredential: true }, token: expect.stringMatching(/^ssf_/) });
    expect(registered.body.service).not.toHaveProperty("lastCheckInAt");
    const read = (path: string, token = registered.body.token as string) => request(server).get(path).set("Authorization", `Bearer ${token}`);
    await request(server).post("/api/services").send({ key: "billing-api" }).expect(409);

    await read("/api/v1/sdk/flags?env=prod").expect(200, { env: "prod", flags: {} });
    await request(server)
      .post("/api/flags")
      .send({ key: "billing-flag", type: "feature", serviceIds: ["svc-billing-api"] })
      .expect(201);
    await read("/api/v1/sdk/flags?env=test").expect(200, { env: "test", flags: { "billing-flag": false } });
    await read("/api/sdk/flags?env=test&service=billing-api").expect(200, { env: "test", flags: { "billing-flag": false } });
    await read(`/api/v1/sdk/flags?env=test&service=${seedState().services[0].key}`).expect(403);
    await read("/api/v1/sdk/flags?env=test", "ssf_not-a-credential").expect(401);
    await sdkGet("/api/v1/sdk/flags?env=test").expect((r) => expect(r.body.flags).toHaveProperty(flag.key));

    const services = await request(server).get("/api/services").expect(200);
    const billing = services.body.find((s: { key: string }) => s.key === "billing-api");
    expect(Date.now() - Date.parse(billing.lastCheckInAt)).toBeLessThan(60_000);
    expect(Object.keys(billing.checkIns).sort()).toEqual(["prod", "test"]);
  });

  it("POST /api/services/:id/credential rotates: the old credential works for 24 h, or stops at once when revoked", async () => {
    const server = app.getHttpServer();
    const read = (token: string) => request(server).get("/api/v1/sdk/flags?env=prod").set("Authorization", `Bearer ${token}`);
    const first = (await request(server).post("/api/services").send({ key: "billing-api" }).expect(201)).body.token as string;

    const rotated = await request(server).post("/api/services/svc-billing-api/credential").send({ actor: "e2e" }).expect(200);
    expect(rotated.body.service).toMatchObject({ credentialStatus: "rotating", previousCredentialExpiresAt: expect.any(String) });
    await read(first).expect(200);
    await read(rotated.body.token).expect(200);

    const revoked = await request(server).post("/api/services/svc-billing-api/credential").send({ revokePrevious: true }).expect(200);
    await read(first).expect(401);
    await read(rotated.body.token).expect(401);
    await read(revoked.body.token).expect(200);
    await request(server).post("/api/services/svc-nope/credential").send({}).expect(404);
    await request(server).post("/api/services/svc-billing-api/credential").send({ revokePrevious: "yes" }).expect(400);
  });

  it("GET /api/sdk/flags rejects an unknown environment and an unknown service", async () => {
    await sdkGet("/api/sdk/flags?env=staging").expect(400);
    await sdkGet("/api/sdk/flags?env=prod&service=nope").expect(404);
  });

  it("POST /api/flags creates a flag (201), 400 on invalid input, 409 on a duplicate key", async () => {
    const created = await request(app.getHttpServer())
      .post("/api/flags")
      .send({ key: "e2e-flag", type: "feature", description: "from e2e", serviceIds: [seedState().services[0].id], actor: "e2e" })
      .expect(201);
    expect(created.body).toMatchObject({ key: "e2e-flag", createdBy: "e2e", services: [{ serviceId: seedState().services[0].id }] });

    await request(app.getHttpServer()).post("/api/flags").send({ key: "bad key", type: "feature" }).expect(400);
    await request(app.getHttpServer()).post("/api/flags").send({ key: "e2e-flag", type: "feature" }).expect(409);
  });

  it("PATCH and DELETE /api/flags/:key update and retire a flag, with 409 when retiring is unsafe", async () => {
    const flag = seedState().flags.find((f) => f.services.some((b) => b.readMode === "runtime"))!;
    const patched = await request(app.getHttpServer()).patch(`/api/flags/${flag.key}`).send({ owner: "e2e-owner" }).expect(200);
    expect(patched.body.owner).toBe("e2e-owner");

    const res = await request(app.getHttpServer()).delete(`/api/flags/${flag.key}`).send({ actor: "e2e" }).expect(409);
    expect(res.body.message).toMatch(/still reads this flag at runtime/);

    const created = await request(app.getHttpServer()).post("/api/flags").send({ key: "throwaway", type: "release" }).expect(201);
    await request(app.getHttpServer()).delete(`/api/flags/${created.body.key}`).send({ actor: "e2e" }).expect(200, { ok: true });
    await sdkGet("/api/sdk/flags?env=test").expect((r) => expect(r.body.flags).not.toHaveProperty("throwaway"));
  });
});
