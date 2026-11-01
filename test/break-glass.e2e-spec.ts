import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types.js";
// @ts-expect-error -- a plain-JS tool script without type declarations
import { hashBreakGlassPassword } from "../scripts/break-glass.mjs";
import { AppModule } from "./../src/app.module.js";
import { configureApp } from "./../src/app.setup.js";
import { FlagsService } from "./../src/flags/flags.service.js";
import type { PrismaClient } from "./../src/generated/prisma/client.js";
import { as } from "./auth.js";
import { resetDatabase, testPrisma } from "./db.js";

const PASSWORD = "correct horse battery staple";

describe("break-glass sign-in (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  const saved = { ...process.env };
  const posted: string[] = [];

  beforeAll(async () => {
    // The general rate limit is off here: the break-glass limit must hold regardless.
    Object.assign(process.env, {
      BREAK_GLASS_PASSWORD_HASH: (hashBreakGlassPassword as (p: string) => string)(PASSWORD),
      TRUST_PROXY: "loopback",
      RATE_LIMIT_PER_MINUTE: "0",
    });
    prisma = testPrisma();
    await resetDatabase(prisma);
    await prisma.notificationSettings.create({ data: { id: 1, enabled: false, webhookUrl: "https://hooks.example.test/T000/B000/xyz" } });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    const flags = app.get(FlagsService);
    flags.webhookLookup = async () => [{ address: "203.0.113.10", family: 4 }]; // a public address
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        posted.push((JSON.parse(init.body as string) as { text: string }).text);
        return new Response("ok");
      }),
    );
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await app.close();
    process.env = saved;
    await prisma.$disconnect();
  });

  const attempt = (body: object, ip: string) =>
    request(app.getHttpServer()).post("/api/auth/break-glass").set("X-Requested-With", "shipscope").set("X-Forwarded-For", ip).send(body);
  const reason = "Keycloak is down, prod flag must be turned off";

  it("is offered on the sign-in page", () => request(app.getHttpServer()).get("/api/auth/options").expect(200, { breakGlass: true }));

  it("starts a one-hour Admin session, announced on the webhook even with notifications off, and logged", async () => {
    const res = await attempt({ password: PASSWORD, reason }, "198.51.100.1").expect(200);
    expect(res.body).toEqual({ username: "break-glass", name: "Break-glass admin", role: "admin", breakGlass: true });
    const cookie = (res.headers["set-cookie"] as unknown as string[]).find((c) => c.startsWith("ssf_session="))!;
    expect(cookie).toMatch(/Max-Age=3600; HttpOnly; SameSite=Lax/);

    const admin = as(app, cookie.split(";")[0]);
    await admin.get("/api/me").expect(200, res.body);
    const created = await admin.post("/api/flags").send({ key: "fixed-in-outage", type: "feature" }).expect(201);
    expect(created.body.createdBy).toBe("break-glass");

    const logged = (await admin.get("/api/audit-log?action=break-glass-login").expect(200)).body.entries as Array<{ actor: string; note: string }>;
    expect(logged).toEqual([expect.objectContaining({ actor: "break-glass", note: `${reason} (from 198.51.100.1)` })]);
    await vi.waitFor(() => expect(posted).toContainEqual(expect.stringMatching(/Break-glass sign-in .* from 198\.51\.100\.1\. Reason: Keycloak is down/)));

    // Signing out goes straight back to the dashboard: the session never went through the provider.
    const out = await admin.post("/api/auth/logout").expect(200);
    expect(out.body).toEqual({ logoutUrl: "http://flags.test/" });
  });

  it("refuses a wrong password with 401, logs and announces it, and stops guessing after five attempts even with rate limits off", async () => {
    for (let i = 0; i < 5; i++) await attempt({ password: `guess-${i}`, reason }, "198.51.100.2").expect(401);
    await attempt({ password: PASSWORD, reason }, "198.51.100.2").expect(429);
    // Another address still has its own attempts.
    await attempt({ password: PASSWORD, reason }, "198.51.100.3").expect(200);

    expect(await prisma.auditLogEntry.count({ where: { action: "break-glass-failed", note: "wrong password from 198.51.100.2" } })).toBe(5);
    await vi.waitFor(() => expect(posted.filter((text) => text.includes("Failed break-glass sign-in"))).toHaveLength(5));
  });

  it("keeps the reason to one line of plain text in the chat message: no mentions, links or forged lines", async () => {
    await attempt({ password: PASSWORD, reason: "SSO down <!channel>\n<https://evil.example|reset> & more" }, "198.51.100.6").expect(200);
    await vi.waitFor(() =>
      expect(posted).toContainEqual(expect.stringContaining("Reason: SSO down &lt;!channel&gt; &lt;https://evil.example|reset&gt; &amp; more")),
    );
    const note = (await prisma.auditLogEntry.findFirstOrThrow({ where: { action: "break-glass-login", note: { contains: "SSO down" } } })).note;
    expect(note).not.toContain("\n");
  });

  it("needs a reason, the CSRF header and no other fields", async () => {
    await attempt({ password: PASSWORD }, "198.51.100.4").expect(400);
    await attempt({ password: PASSWORD, reason: "because" }, "198.51.100.4").expect(400);
    await attempt({ password: PASSWORD, reason, role: "admin" }, "198.51.100.4").expect(400);
    await request(app.getHttpServer()).post("/api/auth/break-glass").set("X-Forwarded-For", "198.51.100.5").send({ password: PASSWORD, reason }).expect(403);
  });
});
