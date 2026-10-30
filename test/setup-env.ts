// Runs before every test file. Tests that touch the database use TEST_DATABASE_URL only: they truncate tables,
// so DATABASE_URL (the development database, possibly from .env) is never used by a test.
try {
  process.loadEnvFile(".env");
} catch {
  // no .env file
}
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
else delete process.env.DATABASE_URL;

// Sign-in settings for the app under test. The provider is never contacted unless a test starts its own fake one
// (test/auth.e2e-spec.ts); the other tests sign in by creating sessions directly (test/auth.ts).
Object.assign(process.env, {
  APP_URL: "http://flags.test",
  OIDC_ISSUER: "https://idp.test/realms/shipscope",
  OIDC_CLIENT_ID: "shipscope-flags",
  OIDC_CLIENT_SECRET: "test-secret",
});
for (const name of [
  "OIDC_DISCOVERY_URL",
  "OIDC_ALLOW_HTTP",
  "OIDC_SCOPES",
  "OIDC_ROLES_CLAIM",
  "OIDC_ADMIN_ROLES",
  "OIDC_EDITOR_ROLES",
  "OIDC_VIEWER_ROLES",
  "SESSION_TTL_HOURS",
])
  delete process.env[name];
