import { defineConfig } from "prisma/config";

// Prisma CLI configuration. Like the start scripts, read ./.env when it exists; exported variables win.
try {
  process.loadEnvFile(".env");
} catch {
  // no .env file
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // `prisma generate` needs no database, so a missing DATABASE_URL only fails the commands that connect.
  datasource: { url: process.env.DATABASE_URL ?? "" },
});
