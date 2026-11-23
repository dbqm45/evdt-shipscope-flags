import { authConfig, authWarnings, roleFromClaims, userFromClaims } from "./auth-config.js";
import { cookie, cookieNames, readCookie } from "./sessions.js";

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

describe("authWarnings", () => {
  it("warns about open viewer access and http to the provider behind an https dashboard", () => {
    expect(authWarnings(authConfig(env))).toEqual([expect.stringMatching(/OIDC_VIEWER_ROLES is empty/)]);
    expect(authWarnings(authConfig({ ...env, OIDC_VIEWER_ROLES: "staff" }))).toEqual([]);
    const httpProvider = authConfig({ ...env, OIDC_VIEWER_ROLES: "staff", OIDC_ISSUER: "http://idp.local/realms/x", OIDC_ALLOW_HTTP: "true" });
    expect(authWarnings(httpProvider)).toEqual([expect.stringMatching(/OIDC_ALLOW_HTTP=true while APP_URL is https/)]);
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
    // A user cannot pose as the system in the audit log.
    expect(userFromClaims({ sub: "u-2", preferred_username: "Break-Glass", email: "bg@x.io" }, settings)).toMatchObject({ username: "bg@x.io" });
    expect(userFromClaims({ sub: "u-3", preferred_username: "shipscope" }, settings)).toMatchObject({ username: "u-3" });
  });
});

describe("the Delivery Intelligence Suite identity service", () => {
  // Claims as the suite realm (dbqm45/di-identity, Keycloak 26.4) puts them in the ID token of di-release-control.
  const suite = authConfig({
    ...env,
    OIDC_CLIENT_ID: "di-release-control",
    OIDC_ROLES_CLAIM: "resource_access.di-release-control.roles",
    OIDC_ADMIN_ROLES: "admin",
    OIDC_EDITOR_ROLES: "editor",
    OIDC_VIEWER_ROLES: "viewer",
    OIDC_ORGANIZATION: "acme",
  });
  const claims = (roles: string[], organization: unknown = ["acme"]) => ({
    sub: "7badb004-5f2f-4791-838f-9ee86d26839d",
    preferred_username: "ola@acme.com",
    name: "Ola Nowak",
    organization,
    resource_access: { "di-release-control": { roles }, "di-release": { roles: ["admin"] } },
  });

  it("reads the organization setting, with the suite's claim name by default", () => {
    expect(suite).toMatchObject({ organization: "acme", organizationClaim: "organization" });
    expect(authConfig(env).organization).toBeUndefined();
    expect(authConfig({ ...env, OIDC_ORGANIZATION: "acme", OIDC_ORGANIZATION_CLAIM: "orgs" }).organizationClaim).toBe("orgs");
  });

  it("takes the role of this application only, not of other suite applications", () => {
    expect(roleFromClaims(claims(["editor"]), suite)).toBe("editor");
    expect(roleFromClaims(claims(["viewer", "admin"]), suite)).toBe("admin");
    expect(roleFromClaims(claims([]), suite)).toBeNull();
  });

  it("keeps out people of other organizations, whatever their roles", () => {
    expect(roleFromClaims(claims(["admin"], ["globex"]), suite)).toBeNull();
    expect(roleFromClaims(claims(["admin"], null), suite)).toBeNull();
    expect(roleFromClaims(claims(["admin"], ["globex", "acme"]), suite)).toBe("admin");
    expect(userFromClaims(claims(["admin"], ["acme"]), suite)).toMatchObject({ username: "ola@acme.com", name: "Ola Nowak", role: "admin" });
  });
});

describe("cookies", () => {
  it("reads one cookie and writes an HttpOnly, SameSite=Lax one, Secure on https", () => {
    expect(readCookie("a=1; ssf_session=abc%3D; b=2", "ssf_session")).toBe("abc=");
    expect(readCookie(undefined, "ssf_session")).toBeUndefined();
    expect(readCookie("ssf_session=%E0%A4%A", "ssf_session")).toBeUndefined();
    expect(cookie("__Host-ssf_session", "t", { maxAgeSeconds: 60, secure: true })).toBe(
      "__Host-ssf_session=t; Path=/; Max-Age=60; HttpOnly; SameSite=Lax; Secure",
    );
  });

  it("uses __Host- names on https, which a sibling subdomain cannot set", () => {
    expect(cookieNames(true)).toEqual({ session: "__Host-ssf_session", login: "__Host-ssf_login" });
    expect(cookieNames(false)).toEqual({ session: "ssf_session", login: "ssf_login" });
  });
});
