import { PrismaClient } from "../src/generated/prisma/client.js";
import { prismaOptions } from "../src/prisma/prisma.service.js";

/** The database for tests (TEST_DATABASE_URL, see .env.example); its tables are truncated by the tests. */
export function testPrisma(): PrismaClient {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Start PostgreSQL (docker compose up -d db) and set it, e.g. " +
        "postgresql://shipscope:shipscope@localhost:5432/shipscope_flags_test (see .env.example).",
    );
  }
  return new PrismaClient(prismaOptions(url));
}

export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "AuditLogEntry", "FlagServiceBinding", "FlagEnvironment", "Flag", "Service", "NotificationSettings", "RuleSettings", "Session" RESTART IDENTITY CASCADE',
  );
}
