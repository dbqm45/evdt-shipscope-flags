import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { App } from "supertest/types.js";
import { FlagClient, type FlagClientError } from "../sdk/client.js";
import { AppModule } from "./../src/app.module.js";
import { configureApp } from "./../src/app.setup.js";
import type { PrismaClient } from "./../src/generated/prisma/client.js";
import { as, signIn } from "./auth.js";
import { resetDatabase, testPrisma } from "./db.js";

describe("reference SDK client against the API (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = testPrisma();
    await resetDatabase(prisma);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.listen(0, "127.0.0.1");
  });

  afterAll(async () => {
    await app.close().catch(() => {});
    await prisma.$disconnect();
  });

  it("reads the service's flags with its credential and keeps serving them once the API is gone", async () => {
    const admin = as(app, await signIn(prisma, "admin"));
    const { token } = (await admin.post("/api/services").send({ key: "checkout" }).expect(201)).body as { token: string };
    await admin
      .post("/api/flags")
      .send({ key: "newCheckout", type: "release", serviceIds: ["svc-checkout"] })
      .expect(201);
    await admin.patch("/api/flags/newCheckout/environments/test").send({ enabled: true }).expect(200);

    const errors: FlagClientError[] = [];
    const flags = await FlagClient.start({
      baseUrl: await app.getUrl(),
      env: "test",
      credential: token,
      defaults: { fromCode: true },
      onError: (e) => errors.push(e),
    });
    flags.stop();
    expect(flags.state).toMatchObject({ source: "server", flags: { newCheckout: true } });
    expect(flags.isEnabled("fromCode")).toBe(true);
    const services = (await admin.get("/api/services").expect(200)).body as Array<{ key: string; checkIns: Record<string, string> }>;
    expect(services.find((s) => s.key === "checkout")!.checkIns).toHaveProperty("test");

    const stranger = await FlagClient.start({ baseUrl: await app.getUrl(), env: "test", credential: "ssf_wrong", onError: (e) => errors.push(e) });
    stranger.stop();
    expect(errors.map((e) => e.kind)).toEqual(["credential"]);

    await app.close();
    expect(await flags.refresh()).toEqual({ ok: false });
    expect(flags.isEnabled("newCheckout")).toBe(true);
    expect(errors.at(-1)!.kind).toBe("unavailable");
  });
});
