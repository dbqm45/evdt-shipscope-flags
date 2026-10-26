import { Test } from "@nestjs/testing";
import { resetDatabase, testPrisma } from "../../test/db.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { PrismaModule } from "../prisma/prisma.service.js";
import { AuditRetention, auditRetentionDays } from "./audit-retention.js";

const NOW = new Date("2026-10-26T12:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

describe("auditRetentionDays", () => {
  it("keeps two years by default, 0 keeps everything, anything else malformed fails", () => {
    expect(auditRetentionDays({})).toBe(730);
    expect(auditRetentionDays({ AUDIT_RETENTION_DAYS: " 90 " })).toBe(90);
    expect(auditRetentionDays({ AUDIT_RETENTION_DAYS: "0" })).toBe(0);
    expect(() => auditRetentionDays({ AUDIT_RETENTION_DAYS: "two years" })).toThrow(/AUDIT_RETENTION_DAYS must be a whole number/);
    expect(() => auditRetentionDays({ AUDIT_RETENTION_DAYS: "-1" })).toThrow(/AUDIT_RETENTION_DAYS/);
  });
});

describe("AuditRetention (PostgreSQL)", () => {
  let prisma: PrismaClient;
  let retention: AuditRetention;

  beforeAll(async () => {
    prisma = testPrisma();
    const moduleRef = await Test.createTestingModule({ imports: [PrismaModule], providers: [AuditRetention] }).compile();
    retention = moduleRef.get(AuditRetention);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await prisma.auditLogEntry.createMany({
      data: [800, 731, 729, 10].map((age) => ({ id: `e${age}`, timestamp: daysAgo(age), actor: "m.chen", action: "env-enabled", flagKey: "f" })),
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const remaining = async () => (await prisma.auditLogEntry.findMany({ orderBy: { timestamp: "asc" } })).map((e) => e.id);

  it("deletes entries older than the retention period and records how many", async () => {
    expect(await retention.prune(NOW, 730)).toBe(2);

    expect(await remaining()).toEqual(["e729", "e10", expect.stringMatching(/^srv-/)]);
    const note = await prisma.auditLogEntry.findFirstOrThrow({ where: { action: "audit-log-pruned" } });
    expect(note).toMatchObject({ actor: "shipscope", note: "removed 2 entries older than 2024-10-26 (kept 730 days)" });
    expect(note.timestamp).toEqual(NOW);

    // Nothing more to remove: no further entry about it.
    expect(await retention.prune(NOW, 730)).toBe(0);
    expect(await prisma.auditLogEntry.count({ where: { action: "audit-log-pruned" } })).toBe(1);
  });

  it("keeps everything when the retention is 0", async () => {
    expect(await retention.prune(NOW, 0)).toBe(0);
    expect(await remaining()).toEqual(["e800", "e731", "e729", "e10"]);
  });
});
