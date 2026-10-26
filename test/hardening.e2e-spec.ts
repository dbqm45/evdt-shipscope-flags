import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types.js";
import { AppModule } from "./../src/app.module.js";
import { configureApp } from "./../src/app.setup.js";
import type { PrismaClient } from "./../src/generated/prisma/client.js";
import { resetDatabase, testPrisma } from "./db.js";

describe("health, security headers and rate limits (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  const saved = { ...process.env };

  beforeAll(async () => {
    Object.assign(process.env, { RATE_LIMIT_PER_MINUTE: "5", RATE_LIMIT_SDK_PER_MINUTE: "3", TRUST_PROXY: "loopback", SDK_TOKEN: "hardening-token" });
    prisma = testPrisma();
    await resetDatabase(prisma);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    process.env = saved;
    await prisma.$disconnect();
  });

  it("GET /api/health is ok, never rate limited, and carries the security headers", async () => {
    for (let i = 0; i < 8; i++) await request(app.getHttpServer()).get("/api/health").expect(200, { status: "ok", database: "ok" });
    const res = await request(app.getHttpServer()).get("/api/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["strict-transport-security"]).toBeDefined();
    expect(res.headers["x-powered-by"]).toBeUndefined();
    await request(app.getHttpServer()).get("/api").expect(404);
  });

  it("limits the consumer endpoint per client address with 429 and Retry-After", async () => {
    const sdk = (ip: string) =>
      request(app.getHttpServer()).get("/api/v1/sdk/flags?env=prod").set("Authorization", "Bearer hardening-token").set("X-Forwarded-For", ip);
    for (let i = 0; i < 3; i++) await sdk("203.0.113.1").expect(200);
    const limited = await sdk("203.0.113.1").expect(429);
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    expect(limited.body.message).toMatch(/Too many requests/);
    // Another client (as the trusted proxy in front reports it) has its own allowance.
    await sdk("203.0.113.2").expect(200);
  });

  it("limits the management API with its own limit", async () => {
    const list = () => request(app.getHttpServer()).get("/api/flags").set("X-Forwarded-For", "198.51.100.7");
    for (let i = 0; i < 5; i++) await list().expect(200);
    await list().expect(429);
  });
});
