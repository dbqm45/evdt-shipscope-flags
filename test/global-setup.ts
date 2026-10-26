import { execFileSync } from "node:child_process";

/** Brings the test database up to the current migrations once per run (fast when it already is). */
export default function setup(): void {
  try {
    process.loadEnvFile(".env");
  } catch {
    // no .env file
  }
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return; // database tests fail with a clear message (test/db.ts); the others still run
  try {
    execFileSync("npx", ["prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  } catch (err) {
    // Vitest fails to print errors thrown here (a source-map bug: "code.charCodeAt is not a function", "No test files
    // found"), so the reason goes to stderr first and the error carries no stack to map.
    const output = String((err as { stderr?: Buffer }).stderr ?? "").trim() || (err as Error).message;
    let where = "TEST_DATABASE_URL";
    try {
      where = `TEST_DATABASE_URL (${new URL(url).host})`;
    } catch {
      // not a URL: Prisma's message says why
    }
    const message = `Could not apply the migrations to ${where}. Is the database running (docker compose up -d db)?\n${output}`;
    console.error(`\n${message}\n`);
    const failure = new Error(message);
    failure.stack = message;
    throw failure;
  }
}
