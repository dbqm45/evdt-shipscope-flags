import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { FLAG_INCLUDE, toAuditEntry, toFlag, toService } from "./flag-mapper.js";
import { canDisable, canEnable } from "./shared/rules.js";
import { ENVIRONMENTS, type AuditLogEntry, type Environment, type Flag, type Service } from "./shared/types.js";

export interface NotificationSettings {
  enabled: boolean;
  /** Slack-compatible incoming webhook (POST {"text": "..."}); any URL accepting JSON works. */
  webhookUrl: string;
}

type Db = PrismaService | Prisma.TransactionClient;

/** Serializes every flag state change: the rules read all flags, so two concurrent toggles must not interleave. */
const STATE_LOCK = 4_242_001;

export function newAuditId(): string {
  return `srv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

@Injectable()
export class FlagsService {
  private readonly logger = new Logger(FlagsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async listFlags(db: Db = this.prisma): Promise<Flag[]> {
    const rows = await db.flag.findMany({ include: FLAG_INCLUDE, orderBy: { seq: "desc" } });
    return rows.map(toFlag);
  }

  async listServices(): Promise<Service[]> {
    const rows = await this.prisma.service.findMany({ orderBy: { seq: "asc" } });
    return rows.map(toService);
  }

  async listAuditLog(): Promise<AuditLogEntry[]> {
    const rows = await this.prisma.auditLogEntry.findMany({ orderBy: [{ timestamp: "desc" }, { seq: "desc" }] });
    return rows.map(toAuditEntry);
  }

  /** Consumer view: `{ flagKey: boolean }` for one environment, optionally only flags bound to a service. */
  async evaluate(env: Environment, serviceKey?: string): Promise<Record<string, boolean>> {
    const service = serviceKey ? await this.prisma.service.findUnique({ where: { key: serviceKey } }) : null;
    if (serviceKey && !service) throw new NotFoundException(`Unknown service "${serviceKey}".`);
    const rows = await this.prisma.flag.findMany({
      where: service ? { services: { some: { serviceId: service.id } } } : undefined,
      select: { key: true, environments: { where: { environment: env }, select: { enabled: true } } },
      orderBy: { seq: "desc" },
    });
    return Object.fromEntries(rows.map((f) => [f.key, f.environments[0]?.enabled ?? false]));
  }

  async setEnvironment(flagKey: string, env: Environment, enabled: boolean, actor: string): Promise<Flag> {
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${STATE_LOCK})::text`;
      const flags = await this.listFlags(tx);
      const flag = flags.find((f) => f.key === flagKey);
      if (!flag) throw new NotFoundException(`Flag "${flagKey}" not found.`);
      const current = flag.environments[env].enabled;
      if (current === enabled) return { flag };

      const check = enabled ? canEnable(flag, env, flags) : canDisable(flag, env, flags);
      if (!check.allowed) {
        // Committed although the request fails: blocked attempts belong in the audit log too.
        await this.audit(tx, { actor, action: "promotion-blocked", flagKey, environment: env, note: check.reason });
        return { flag, blocked: check.reason };
      }

      const state = { enabled, updatedAt: new Date().toISOString(), updatedBy: actor };
      await tx.flagEnvironment.update({ where: { flagId_environment: { flagId: flag.id, environment: env } }, data: state });
      await this.audit(tx, {
        actor,
        action: enabled ? "env-enabled" : "env-disabled",
        flagKey,
        environment: env,
        from: current ? "on" : "off",
        to: enabled ? "on" : "off",
      });
      return { flag: { ...flag, environments: { ...flag.environments, [env]: state } }, changed: true };
    });

    if (result.blocked) throw new ConflictException(result.blocked);
    if (result.changed && env === "prod") void this.notify(`:rotating_light: *${flagKey}* was turned *${enabled ? "ON" : "OFF"}* in *PROD* by ${actor}`);
    return result.flag;
  }

  async getNotifications(): Promise<NotificationSettings> {
    const row = await this.prisma.notificationSettings.findUnique({ where: { id: 1 } });
    return row ? { enabled: row.enabled, webhookUrl: row.webhookUrl } : { enabled: false, webhookUrl: process.env.NOTIFY_WEBHOOK_URL ?? "" };
  }

  async setNotifications(input: Partial<NotificationSettings>): Promise<NotificationSettings> {
    const next = { ...(await this.getNotifications()), ...input };
    if (next.enabled && !/^https?:\/\//.test(next.webhookUrl)) {
      throw new BadRequestException("A valid http(s) webhook URL is required to enable notifications.");
    }
    await this.prisma.notificationSettings.upsert({ where: { id: 1 }, create: { id: 1, ...next }, update: next });
    return next;
  }

  async testNotification(): Promise<{ ok: boolean; error?: string }> {
    return this.notify("Test message from ShipScope Flags", true);
  }

  private async notify(text: string, force = false): Promise<{ ok: boolean; error?: string }> {
    const { enabled, webhookUrl } = await this.getNotifications();
    if (!force && !enabled) return { ok: false, error: "disabled" };
    if (!webhookUrl) return { ok: false, error: "no webhook URL" };
    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { ok: true };
    } catch (err) {
      this.logger.warn(`Notification failed: ${(err as Error).message}`);
      return { ok: false, error: (err as Error).message };
    }
  }

  private async audit(db: Db, entry: Omit<AuditLogEntry, "id" | "timestamp">): Promise<void> {
    await db.auditLogEntry.create({ data: { ...entry, id: newAuditId(), timestamp: new Date().toISOString() } });
  }
}

export function isEnvironment(value: string): value is Environment {
  return (ENVIRONMENTS as string[]).includes(value);
}
