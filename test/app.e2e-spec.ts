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

  beforeAll(async () => {
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
    await prisma.$disconnect();
  });

  it("GET /api", () => request(app.getHttpServer()).get("/api").expect(200).expect("Hello World!"));

  it("GET /api/flags returns the stored flags", async () => {
    const res = await request(app.getHttpServer()).get("/api/flags").expect(200);
    expect(res.body.map((f: { key: string }) => f.key)).toEqual(seedState().flags.map((f) => f.key));
  });

  it("PATCH /api/flags/:key/environments/:env changes the state, and 409 when the rules block it", async () => {
    const flag = seedState().flags.find((f) => f.environments.test.enabled && !f.environments.qa.enabled && !f.dependsOn)!;
    await request(app.getHttpServer()).patch(`/api/flags/${flag.key}/environments/prod`).send({ enabled: true }).expect(409);
    const patched = await request(app.getHttpServer()).patch(`/api/flags/${flag.key}/environments/qa`).send({ enabled: true, actor: "e2e" }).expect(200);
    expect(patched.body).toMatchObject({ ok: true, flag: { key: flag.key, environments: { qa: { enabled: true, updatedBy: "e2e" } } } });

    const sdk = await request(app.getHttpServer()).get("/api/sdk/flags?env=qa").expect(200);
    expect(sdk.body).toMatchObject({ env: "qa", flags: { [flag.key]: true } });
  });

  it("GET /api/sdk/flags rejects an unknown environment and an unknown service", async () => {
    await request(app.getHttpServer()).get("/api/sdk/flags?env=staging").expect(400);
    await request(app.getHttpServer()).get("/api/sdk/flags?env=prod&service=nope").expect(404);
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
    await request(app.getHttpServer())
      .get("/api/sdk/flags?env=test")
      .expect((r) => expect(r.body.flags).not.toHaveProperty("throwaway"));
  });
});
