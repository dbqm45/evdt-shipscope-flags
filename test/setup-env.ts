// Runs before every test file. Tests that touch the database use TEST_DATABASE_URL only: they truncate tables,
// so DATABASE_URL (the development database, possibly from .env) is never used by a test.
try {
  process.loadEnvFile(".env");
} catch {
  // no .env file
}
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
else delete process.env.DATABASE_URL;
