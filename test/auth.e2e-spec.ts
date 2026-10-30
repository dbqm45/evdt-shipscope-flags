import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createServer, type Server } from "node:http";
import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import type { AddressInfo } from "node:net";
import request from "supertest";
import type { App } from "supertest/types.js";
import { AppModule } from "./../src/app.module.js";
import { configureApp } from "./../src/app.setup.js";
import type { PrismaClient } from "./../src/generated/prisma/client.js";
import { as, signIn } from "./auth.js";
import { resetDatabase, testPrisma } from "./db.js";

// Sign-in end to end against a minimal OpenID provider in this process: discovery, JWKS and a token endpoint that
// issues an RS256 ID token for the user the test chooses. The browser's part (following redirects, keeping cookies)
// is played by hand, so each check the API makes on the way can be seen.

const base64url = (value: Buffer | string) => Buffer.from(value).toString("base64url");

function fakeProvider() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const codes = new Map<string, { nonce: string; challenge: string; claims: Record<string, unknown> }>();
  let nextUser: Record<string, unknown> = {};
  let issuer = "";
  const idToken = (key: KeyObject, claims: Record<string, unknown>) => {
    const input = `${base64url(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" }))}.${base64url(JSON.stringify(claims))}`;
    return `${input}.${base64url(sign("sha256", Buffer.from(input), key))}`;
  };
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url!, issuer);
    const json = (body: unknown, status = 200) => res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
    if (url.pathname.endsWith("/.well-known/openid-configuration"))
      return json({
        issuer,
        authorization_endpoint: `${issuer}/auth`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        end_session_endpoint: `${issuer}/logout`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
      });
    if (url.pathname.endsWith("/jwks")) return json({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" }] });
    if (url.pathname.endsWith("/token")) {
      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk.toString()));
      req.on("end", () => {
        const form = new URLSearchParams(body);
        const grant = codes.get(form.get("code") ?? "");
        const verifier = form.get("code_verifier") ?? "";
        if (!grant || base64url(createHash("sha256").update(verifier).digest()) !== grant.challenge) return json({ error: "invalid_grant" }, 400);
        const now = Math.floor(Date.now() / 1000);
        const claims = { iss: issuer, aud: "shipscope-flags", iat: now, exp: now + 300, nonce: grant.nonce, ...grant.claims };
        json({ access_token: "at", token_type: "Bearer", expires_in: 300, id_token: idToken(privateKey, claims) });
      });
      return;
    }
    json({ error: "not_found" }, 404);
  });
  return {
    async start() {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}/realms/shipscope`;
      return issuer;
    },
    stop: () => new Promise((resolve) => server.close(resolve)),
    /** Plays the user signing in at the provider: returns the redirect back to the API, with a code for `claims`. */
    approve(authorizationUrl: string, claims: Record<string, unknown>) {
      const auth = new URL(authorizationUrl);
      const code = `code-${codes.size}`;
      codes.set(code, { nonce: auth.searchParams.get("nonce")!, challenge: auth.searchParams.get("code_challenge")!, claims: { ...nextUser, ...claims } });
      const back = new URL(auth.searchParams.get("redirect_uri")!);
      back.searchParams.set("code", code);
      back.searchParams.set("state", auth.searchParams.get("state")!);
      return back;
    },
    setDefaults(claims: Record<string, unknown>) {
      nextUser = claims;
    },
  };
}

/** The cookies a response sets, as name → "name=value" (an emptied cookie maps to its name with no value). */
const setCookies = (res: request.Response) =>
  Object.fromEntries(((res.headers["set-cookie"] as unknown as string[] | undefined) ?? []).map((c) => [c.split("=")[0], c.split(";")[0]]));

describe("sign-in and roles (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  const provider = fakeProvider();
  const saved = { ...process.env };

  beforeAll(async () => {
    const issuer = await provider.start();
    provider.setDefaults({ sub: "u-1", preferred_username: "a.kowalska", name: "Anna Kowalska", email: "a.kowalska@example.com" });
    Object.assign(process.env, { OIDC_ISSUER: issuer, OIDC_ALLOW_HTTP: "true", OIDC_ROLES_CLAIM: "realm_access.roles" });
    prisma = testPrisma();
    await resetDatabase(prisma);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await provider.stop();
    process.env = saved;
    await prisma.$disconnect();
  });

  /** The whole browser round trip; returns the final redirect and the session cookie, if one was set. */
  async function login(claims: Record<string, unknown>, tamper?: (callback: URL) => void) {
    const server = app.getHttpServer();
    const start = await request(server).get("/api/auth/login").expect(302);
    const loginCookie = setCookies(start).ssf_login;
    expect(start.headers["set-cookie"]![0]).toMatch(/HttpOnly; SameSite=Lax/);
    const callback = provider.approve(start.headers.location!, claims);
    tamper?.(callback);
    const done = await request(server)
      .get(callback.pathname + callback.search)
      .set("Cookie", loginCookie)
      .expect(302);
    return { location: done.headers.location!, session: setCookies(done).ssf_session };
  }

  it("signs a user in through the provider, maps the role from the claims and records changes under their name", async () => {
    const { location, session } = await login({ realm_access: { roles: ["shipscope-editor"] } });
    expect(location).toBe("http://flags.test/");
    expect(session).toMatch(/^ssf_session=.{20,}/);
    await request(app.getHttpServer())
      .get("/api/me")
      .set("Cookie", session)
      .expect(200, { username: "a.kowalska", name: "Anna Kowalska", email: "a.kowalska@example.com", role: "editor" });

    const editor = as(app, session);
    const created = await editor.post("/api/flags").send({ key: "sso-flag", type: "feature" }).expect(201);
    expect(created.body.createdBy).toBe("a.kowalska");
    // The author is never taken from the body any more.
    await editor.patch("/api/flags/sso-flag").send({ owner: "x", actor: "someone-else" }).expect(400);
    const entries = (await editor.get("/api/audit-log?flagKey=sso-flag").expect(200)).body.entries as Array<{ actor: string }>;
    expect(entries.map((e) => e.actor)).toEqual(["a.kowalska"]);
  });

  it("refuses a callback with a wrong state, a reused code or a provider error, and starts no session", async () => {
    expect(await login({}, (cb) => cb.searchParams.set("state", "forged"))).toEqual({ location: "http://flags.test/?login_error=failed", session: undefined });
    expect(await login({}, (cb) => cb.searchParams.set("code", "code-unknown"))).toMatchObject({ location: "http://flags.test/?login_error=failed" });
    expect(await login({}, (cb) => cb.searchParams.set("error", "access_denied"))).toMatchObject({ location: "http://flags.test/?login_error=denied" });
    const noLoginCookie = await request(app.getHttpServer()).get("/api/auth/callback?code=x&state=y").expect(302);
    expect(noLoginCookie.headers.location).toBe("http://flags.test/?login_error=expired");
  });

  it("keeps out users without a listed role when OIDC_VIEWER_ROLES is set", async () => {
    // The setting is read when the app starts, so this test changes it on the running instance.
    const oidc = app.get((await import("../src/auth/oidc.js")).OidcClient);
    oidc.config.viewerRoles = ["shipscope-viewer"];
    try {
      expect(await login({ realm_access: { roles: ["other-app"] } })).toEqual({ location: "http://flags.test/?login_error=no-role", session: undefined });
      expect((await login({ realm_access: { roles: ["shipscope-viewer"] } })).session).toBeDefined();
    } finally {
      oidc.config.viewerRoles = [];
    }
  });

  it("signs out: the session ends and the answer names the provider's sign-out page", async () => {
    const { session } = await login({ realm_access: { roles: ["shipscope-admin"] } });
    const out = await request(app.getHttpServer()).post("/api/auth/logout").set("Cookie", session).expect(200);
    expect(out.body.logoutUrl).toMatch(/\/realms\/shipscope\/logout\?.*post_logout_redirect_uri=http%3A%2F%2Fflags\.test%2F.*id_token_hint=/);
    expect(setCookies(out).ssf_session).toBe("ssf_session=");
    await request(app.getHttpServer()).get("/api/me").set("Cookie", session).expect(401);
  });

  it("guards the management API: 401 without a session, 403 below the needed role or without the CSRF header", async () => {
    const server = app.getHttpServer();
    await request(server).get("/api/flags").expect(401);
    await request(server).get("/api/me").set("Cookie", "ssf_session=forged").expect(401);
    await request(server).get("/api/health").expect(200);

    const viewer = as(app, await signIn(prisma, "viewer"));
    const editor = as(app, await signIn(prisma, "editor"));
    const admin = as(app, await signIn(prisma, "admin"));
    await viewer.get("/api/flags").expect(200);
    await viewer.post("/api/flags").send({ key: "nope", type: "feature" }).expect(403);
    await editor.post("/api/flags").send({ key: "guarded", type: "feature" }).expect(201);
    await editor.patch("/api/flags/guarded/environments/test").send({ enabled: true }).expect(200);
    await editor.put("/api/settings/notifications").send({ enabled: false }).expect(200);

    // Admin only: services, rule thresholds and a flag's own notifications.
    await editor.post("/api/services").send({ key: "billing" }).expect(403);
    await editor.put("/api/settings/rules").send({ staleThresholdDays: 10 }).expect(403);
    await editor.patch("/api/flags/guarded").send({ notify: true }).expect(403);
    await admin.post("/api/services").send({ key: "billing" }).expect(201);
    await admin.put("/api/settings/rules").send({ staleThresholdDays: 10 }).expect(200);
    await admin.patch("/api/flags/guarded").send({ notify: true }).expect(200);

    // A change without the header a cross-site form cannot send.
    const cookie = await signIn(prisma, "admin");
    await request(server).post("/api/flags").set("Cookie", cookie).send({ key: "csrf", type: "feature" }).expect(403);
  });

  it("does not accept an expired session", async () => {
    const cookie = await signIn(prisma, "admin", "expired");
    await prisma.session.updateMany({ where: { username: "expired" }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await request(app.getHttpServer()).get("/api/me").set("Cookie", cookie).expect(401);
  });
});
