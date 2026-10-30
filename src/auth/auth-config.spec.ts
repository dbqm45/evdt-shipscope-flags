import { authConfig, roleFromClaims, userFromClaims } from "./auth-config.js";
import { cookie, readCookie } from "./sessions.js";

const env = {
  APP_URL: "https://flags.example.com/",
  OIDC_ISSUER: "https://login.example.com/realms/eng",
  OIDC_CLIENT_ID: "shipscope-flags",
  OIDC_CLIENT_SECRET: "s3cret",
};

describe("authConfig", () => {
  it("reads the settings with their defaults", () => {
    expect(authConfig(env)).toMatchObject({
      issuer: "https://login.example.com/realms/eng",
      scopes: "openid profile email",
      rolesClaim: "roles",
      adminRoles: ["shipscope-admin"],
      editorRoles: ["shipscope-editor"],
      viewerRoles: [],
      sessionTtlMs: 12 * 60 * 60 * 1000,
    });
    expect(authConfig(env).appUrl.href).toBe("https://flags.example.com/");
    expect(authConfig({ ...env, OIDC_ADMIN_ROLES: " ops , sre ", SESSION_TTL_HOURS: "8" })).toMatchObject({
      adminRoles: ["ops", "sre"],
      sessionTtlMs: 8 * 3_600_000,
    });
  });

  it("stops the API on a missing or unsafe setting", () => {
    expect(() => authConfig({ ...env, OIDC_CLIENT_SECRET: "", APP_URL: undefined })).toThrow("set APP_URL, OIDC_CLIENT_SECRET");
    expect(() => authConfig({ ...env, OIDC_ISSUER: "login.example.com" })).toThrow(/OIDC_ISSUER must be an http\(s\) URL/);
    expect(() => authConfig({ ...env, OIDC_ISSUER: "http://localhost:8180/realms/shipscope" })).toThrow(/OIDC_ALLOW_HTTP/);
    expect(authConfig({ ...env, OIDC_ISSUER: "http://localhost:8180/realms/shipscope", OIDC_ALLOW_HTTP: "true" }).allowHttp).toBe(true);
    expect(() => authConfig({ ...env, SESSION_TTL_HOURS: "forever" })).toThrow(/SESSION_TTL_HOURS/);
  });
});

describe("roles from the provider's claims", () => {
  const settings = { rolesClaim: "realm_access.roles", adminRoles: ["shipscope-admin"], editorRoles: ["shipscope-editor"], viewerRoles: [] };

  it("takes the highest role found under the configured claim, else viewer", () => {
    expect(roleFromClaims({ realm_access: { roles: ["shipscope-editor", "shipscope-admin"] } }, settings)).toBe("admin");
    expect(roleFromClaims({ realm_access: { roles: ["shipscope-editor"] } }, settings)).toBe("editor");
    expect(roleFromClaims({ realm_access: { roles: ["offline_access"] } }, settings)).toBe("viewer");
    expect(roleFromClaims({}, settings)).toBe("viewer");
    expect(roleFromClaims({ groups: "shipscope-admin" }, { ...settings, rolesClaim: "groups" })).toBe("admin");
  });

  it("keeps out users with no listed role when viewer roles are set", () => {
    const strict = { ...settings, viewerRoles: ["shipscope-viewer"] };
    expect(roleFromClaims({ realm_access: { roles: ["offline_access"] } }, strict)).toBeNull();
    expect(roleFromClaims({ realm_access: { roles: ["shipscope-viewer"] } }, strict)).toBe("viewer");
    expect(userFromClaims({ sub: "u-1" }, strict)).toBeNull();
  });

  it("names the user by preferred_username, else email, else the subject", () => {
    expect(userFromClaims({ sub: "u-1", preferred_username: "m.chen", name: "Mei Chen", email: "m@x.io" }, settings)).toEqual({
      username: "m.chen",
      name: "Mei Chen",
      email: "m@x.io",
      role: "viewer",
    });
    expect(userFromClaims({ sub: "u-1", email: "m@x.io" }, settings)).toMatchObject({ username: "m@x.io", name: "m@x.io" });
    expect(userFromClaims({ sub: "u-1" }, settings)).toEqual({ username: "u-1", name: "u-1", email: undefined, role: "viewer" });
  });
});

describe("cookies", () => {
  it("reads one cookie and writes an HttpOnly, SameSite=Lax one, Secure on https", () => {
    expect(readCookie("a=1; ssf_session=abc%3D; b=2", "ssf_session")).toBe("abc=");
    expect(readCookie(undefined, "ssf_session")).toBeUndefined();
    expect(readCookie("ssf_session=%E0%A4%A", "ssf_session")).toBeUndefined();
    expect(cookie("ssf_session", "t", { path: "/api", maxAgeSeconds: 60, secure: true })).toBe(
      "ssf_session=t; Path=/api; Max-Age=60; HttpOnly; SameSite=Lax; Secure",
    );
  });
});
