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
    await request(app.getHttpServer()).patch(`/api/flags/${flag.key}/environments/qa`).send({ enabled: true, actor: "e2e" }).expect(200);

    const sdk = await request(app.getHttpServer()).get("/api/sdk/flags?env=qa").expect(200);
    expect(sdk.body).toMatchObject({ env: "qa", flags: { [flag.key]: true } });
  });

  it("GET /api/sdk/flags rejects an unknown environment and an unknown service", async () => {
    await request(app.getHttpServer()).get("/api/sdk/flags?env=staging").expect(400);
    await request(app.getHttpServer()).get("/api/sdk/flags?env=prod&service=nope").expect(404);
  });
});
