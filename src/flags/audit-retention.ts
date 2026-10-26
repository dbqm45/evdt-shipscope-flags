import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { newAuditId } from "./flags.service.js";

// Audit log retention (PRD Open Question 1, decided: keep two years, delete older entries). Once a day the API
// deletes the entries older than AUDIT_RETENTION_DAYS and records in the log how many it removed.

const DAY_MS = 24 * 60 * 60 * 1000;
/** The first run waits a little after start-up, so a restart loop does not hammer the database. */
const FIRST_RUN_DELAY_MS = 60_000;
/** Held for one run, so with several API instances only one prunes at a time. */
const PRUNE_LOCK = 4_242_002;

/** Days to keep audit entries (default 730, two years); 0 keeps them for good. Throws on a malformed value. */
export function auditRetentionDays(env = process.env): number {
  const raw = env.AUDIT_RETENTION_DAYS?.trim();
  if (!raw) return 730;
  const days = Number(raw);
  if (!Number.isInteger(days) || days < 0) throw new Error(`AUDIT_RETENTION_DAYS must be a whole number of days (0 keeps everything), not "${raw}".`);
  return days;
}

@Injectable()
export class AuditRetention implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AuditRetention.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap(): void {
    if (auditRetentionDays() === 0) return;
    const run = () => void this.prune().catch((err: Error) => this.logger.warn(`Audit log pruning failed: ${err.message}`));
    this.timer = setTimeout(() => {
      run();
      this.timer = setInterval(run, DAY_MS);
      this.timer.unref();
    }, FIRST_RUN_DELAY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearTimeout(this.timer);
    clearInterval(this.timer);
  }

  /** Deletes the entries older than the retention period; returns how many (null when another instance is pruning). */
  async prune(now = new Date(), days = auditRetentionDays()): Promise<number | null> {
    if (days === 0) return 0;
    const cutoff = new Date(now.getTime() - days * DAY_MS);
    return this.prisma.$transaction(async (tx) => {
      const [{ locked }] = await tx.$queryRaw<[{ locked: boolean }]>`SELECT pg_try_advisory_xact_lock(${PRUNE_LOCK}) AS locked`;
      if (!locked) return null;
      const { count } = await tx.auditLogEntry.deleteMany({ where: { timestamp: { lt: cutoff } } });
      if (count > 0) {
        await tx.auditLogEntry.create({
          data: {
            id: newAuditId(),
            timestamp: now,
            actor: "shipscope",
            action: "audit-log-pruned",
            note: `removed ${count} ${count === 1 ? "entry" : "entries"} older than ${cutoff.toISOString().slice(0, 10)} (kept ${days} days)`,
          },
        });
        this.logger.log(`Removed ${count} audit entries older than ${cutoff.toISOString()}.`);
      }
      return count;
    });
  }
}
