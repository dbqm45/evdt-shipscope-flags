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
  execFileSync("npx", ["prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
}
