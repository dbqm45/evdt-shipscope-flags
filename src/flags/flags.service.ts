import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { FLAG_INCLUDE, SERVICE_INCLUDE, toAuditEntry, toDbReadMode, toFlag, toService } from "./flag-mapper.js";
import { encodeAuditCursor, type BindingPatch, type CreateFlagInput, type FlagPatch, type ParsedAuditQuery, type RegisterServiceInput } from "./flags.input.js";
import { CREDENTIAL_GRACE_MS, hashToken, newServiceToken } from "./sdk-auth.js";
import { canDisable, canEnable, canRetire } from "./shared/rules.js";
import { checkWebhookUrl, maskWebhookUrl, type Lookup } from "./webhook.js";
import { ENVIRONMENTS, type AuditLogEntry, type AuditLogPage, type Environment, type Flag, type NotificationSettings, type Service } from "./shared/types.js";

/** A service and its new credential: the only time the credential is shown. */
export interface IssuedCredential {
  service: Service;
  token: string;
}

type Db = PrismaService | Prisma.TransactionClient;

/** A service's check-in is stored at most this often, so services polling every few seconds cost no extra writes. */
const CHECK_IN_INTERVAL_MS = 30_000;

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
    const rows = await this.prisma.service.findMany({ include: SERVICE_INCLUDE, orderBy: { seq: "asc" } });
    return rows.map((row) => toService(row));
  }

  /** One page of the audit log, newest first, filtered; `nextCursor` continues it with older entries. */
  async listAuditLog(query: ParsedAuditQuery = { limit: 50 }): Promise<AuditLogPage> {
    const { limit, before, flagKey, serviceKey, action, actor, q } = query;
    const where: Prisma.AuditLogEntryWhereInput = {
      flagKey,
      serviceKey,
      action,
      actor,
      AND: [
        // Keyset pagination on the sort order, so entries written meanwhile do not shift the pages.
        before ? { OR: [{ timestamp: { lt: before.timestamp } }, { timestamp: before.timestamp, seq: { lt: before.seq } }] } : {},
        q
          ? {
              OR: (["actor", "flagKey", "serviceKey", "note"] as const).map((field) => ({ [field]: { contains: q, mode: "insensitive" as const } })),
            }
          : {},
      ],
    };
    const rows = await this.prisma.auditLogEntry.findMany({ where, orderBy: [{ timestamp: "desc" }, { seq: "desc" }], take: limit + 1 });
    const page: AuditLogPage = { entries: rows.slice(0, limit).map(toAuditEntry) };
    const last = rows[limit - 1];
    if (rows.length > limit && last) page.nextCursor = encodeAuditCursor(last);
    return page;
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

  /** The service a credential digest belongs to: its current credential, or the previous one while the rotation grace period lasts. */
  serviceByToken(tokenHash: string): Promise<{ id: string; key: string } | null> {
    return this.prisma.service.findFirst({
      where: { OR: [{ tokenHash }, { previousTokenHash: tokenHash, previousTokenExpiresAt: { gt: new Date() } }] },
      select: { id: true, key: true },
    });
  }

  /** Records that a service read its flags for `env`. Never fails the read: a lost check-in only makes the service look quieter. */
  async recordCheckIn(serviceId: string, env: Environment): Promise<void> {
    const now = new Date();
    const due = new Date(now.getTime() - CHECK_IN_INTERVAL_MS);
    try {
      // One statement: insert, or move the time forward only when the stored one is older than the interval.
      await this.prisma.$executeRaw`
        INSERT INTO "ServiceCheckIn" ("serviceId", "environment", "at") VALUES (${serviceId}, ${env}::"Environment", ${now})
        ON CONFLICT ("serviceId", "environment") DO UPDATE SET "at" = EXCLUDED."at" WHERE "ServiceCheckIn"."at" < ${due}`;
    } catch (err) {
      this.logger.warn(`Could not record the check-in of service ${serviceId}: ${(err as Error).message}`);
    }
  }

  async registerService(input: RegisterServiceInput, actor: string): Promise<IssuedCredential> {
    const token = newServiceToken();
    const row = await this.locked(async (tx) => {
      const id = `svc-${input.key}`;
      if (await tx.service.findFirst({ where: { OR: [{ key: input.key }, { id }] } }))
        throw new ConflictException(`A service with the key "${input.key}" already exists.`);
      const now = new Date();
      const created = await tx.service.create({
        include: SERVICE_INCLUDE,
        data: { id, key: input.key, name: input.name, registeredAt: now, registeredBy: actor, tokenHash: hashToken(token), credentialLastRotated: now },
      });
      await this.audit(tx, { actor, action: "service-registered", serviceKey: input.key });
      return created;
    });
    return { service: toService(row), token };
  }

  /**
   * Issues a new credential. The one it replaces keeps working for CREDENTIAL_GRACE_MS so the service can be redeployed,
   * unless `revokePrevious` (a leaked credential) ends it at once. A credential older than that is always ended.
   */
  async rotateCredential(serviceId: string, revokePrevious: boolean, actor: string): Promise<IssuedCredential> {
    const token = newServiceToken();
    const row = await this.locked(async (tx) => {
      const current = await tx.service.findUnique({ where: { id: serviceId } });
      if (!current) throw new NotFoundException(`Service "${serviceId}" not found.`);
      const now = new Date();
      const keepPrevious = current.tokenHash !== null && !revokePrevious;
      const until = new Date(now.getTime() + CREDENTIAL_GRACE_MS);
      const updated = await tx.service.update({
        include: SERVICE_INCLUDE,
        where: { id: serviceId },
        data: {
          tokenHash: hashToken(token),
          previousTokenHash: keepPrevious ? current.tokenHash : null,
          previousTokenExpiresAt: keepPrevious ? until : null,
          credentialLastRotated: now,
        },
      });
      const note = !current.tokenHash
        ? "first credential issued"
        : keepPrevious
          ? `previous credential works until ${until.toISOString()}`
          : "previous credential revoked";
      await this.audit(tx, { actor, action: "credential-rotated", serviceKey: current.key, note });
      return updated;
    });
    return { service: toService(row), token };
  }

  /** Runs `fn` in a transaction holding STATE_LOCK: every write that a rule (which reads all flags) depends on goes here. */
  private locked<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${STATE_LOCK})::text`;
      return fn(tx);
    });
  }

  private async flagByKey(db: Db, key: string): Promise<Flag> {
    const row = await db.flag.findUnique({ where: { key }, include: FLAG_INCLUDE });
    if (!row) throw new NotFoundException(`Flag "${key}" not found.`);
    return toFlag(row);
  }

  async createFlag(input: CreateFlagInput, actor: string): Promise<Flag> {
    return this.locked(async (tx) => {
      if (await tx.flag.findUnique({ where: { key: input.key } })) throw new ConflictException(`A flag with the key "${input.key}" already exists.`);
      if (input.dependsOn && !(await tx.flag.findUnique({ where: { key: input.dependsOn } }))) {
        throw new BadRequestException(`"dependsOn" names a flag that does not exist: "${input.dependsOn}".`);
      }
      const services = await tx.service.findMany({ where: { id: { in: input.serviceIds } } });
      const missing = input.serviceIds.filter((id) => !services.some((s) => s.id === id));
      if (missing.length) throw new BadRequestException(`Unknown service id${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.`);

      const now = new Date();
      await tx.flag.create({
        data: {
          id: `flag-${input.key}`,
          key: input.key,
          description: input.description,
          type: input.type,
          createdAt: now,
          createdBy: actor,
          dependsOn: input.dependsOn ?? null,
          owner: input.owner ?? actor,
          reviewBy: input.reviewBy ? new Date(input.reviewBy) : null,
          tags: input.tags,
          environments: { create: ENVIRONMENTS.map((environment) => ({ environment, enabled: false, updatedAt: now, updatedBy: actor })) },
          services: {
            create: input.serviceIds.map((serviceId, position) => ({ serviceId, position, readMode: "runtime" })),
          },
        },
      });
      await this.audit(tx, { actor, action: "flag-created", flagKey: input.key });
      for (const id of input.serviceIds) {
        await this.audit(tx, { actor, action: "service-assigned", flagKey: input.key, serviceKey: services.find((s) => s.id === id)!.key });
      }
      return this.flagByKey(tx, input.key);
    });
  }

  async updateFlag(flagKey: string, patch: FlagPatch, actor: string): Promise<Flag> {
    return this.locked(async (tx) => {
      await this.flagByKey(tx, flagKey);
      await tx.flag.update({
        where: { key: flagKey },
        data: {
          description: patch.description,
          owner: patch.owner,
          reviewBy: patch.reviewBy === undefined ? undefined : patch.reviewBy && new Date(patch.reviewBy),
          tags: patch.tags,
          notify: patch.notify,
        },
      });
      await this.audit(tx, { actor, action: "flag-updated", flagKey, note: `updated ${Object.keys(patch).join(", ")}` });
      return this.flagByKey(tx, flagKey);
    });
  }

  async updateBinding(flagKey: string, serviceId: string, patch: BindingPatch, actor: string): Promise<Flag> {
    return this.locked(async (tx) => {
      const flag = await this.flagByKey(tx, flagKey);
      const binding = await tx.flagServiceBinding.findUnique({ where: { flagId_serviceId: { flagId: flag.id, serviceId } }, include: { service: true } });
      if (!binding) throw new NotFoundException(`Flag "${flagKey}" is not assigned to service "${serviceId}".`);
      await tx.flagServiceBinding.update({
        where: { flagId_serviceId: { flagId: flag.id, serviceId } },
        data: {
          readMode: patch.readMode && toDbReadMode(patch.readMode),
          buildTimeValues: patch.buildTimeValues,
          removedFromCode: patch.removedFromCode,
        },
      });
      await this.audit(tx, { actor, action: "binding-updated", flagKey, serviceKey: binding.service.key, note: `updated ${Object.keys(patch).join(", ")}` });
      return this.flagByKey(tx, flagKey);
    });
  }

  /** Removes a flag, only when that cannot change any service's behaviour (rule 5, canRetire). */
  async retireFlag(flagKey: string, actor: string): Promise<void> {
    await this.locked(async (tx) => {
      const flags = await this.listFlags(tx);
      const flag = flags.find((f) => f.key === flagKey);
      if (!flag) throw new NotFoundException(`Flag "${flagKey}" not found.`);
      const services = await tx.service.findMany({ select: { id: true, key: true } });
      const check = canRetire(flag, flags, (id) => services.find((s) => s.id === id)?.key ?? id);
      if (!check.allowed) throw new ConflictException(check.blockers.join(" "));
      await tx.flag.delete({ where: { key: flagKey } });
      await this.audit(tx, { actor, action: "flag-retired", flagKey });
    });
  }

  async setEnvironment(flagKey: string, env: Environment, enabled: boolean, actor: string): Promise<Flag> {
    const result = await this.locked(async (tx) => {
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
    if (result.changed && env === "prod")
      void this.notifyChange(result.flag, `:rotating_light: *${flagKey}* was turned *${enabled ? "ON" : "OFF"}* in *PROD* by ${actor}`);
    return result.flag;
  }

  /** DNS lookup used to vet webhook hosts; tests replace it. */
  webhookLookup: Lookup | undefined;

  private async storedNotifications(): Promise<NotificationSettings> {
    const row = await this.prisma.notificationSettings.findUnique({ where: { id: 1 } });
    return row ? { enabled: row.enabled, webhookUrl: row.webhookUrl } : { enabled: false, webhookUrl: process.env.NOTIFY_WEBHOOK_URL ?? "" };
  }

  /** The settings as the API shows them: the webhook URL is a secret, so only a masked form leaves the server. */
  async getNotifications(): Promise<NotificationSettings> {
    const stored = await this.storedNotifications();
    return { enabled: stored.enabled, webhookUrl: maskWebhookUrl(stored.webhookUrl) };
  }

  /** Sending the masked URL back unchanged keeps the stored one, so the settings form can save `enabled` alone. */
  async setNotifications(input: Partial<NotificationSettings>): Promise<NotificationSettings> {
    const stored = await this.storedNotifications();
    const webhookUrl = input.webhookUrl === undefined || input.webhookUrl === maskWebhookUrl(stored.webhookUrl) ? stored.webhookUrl : input.webhookUrl;
    const next = { enabled: input.enabled ?? stored.enabled, webhookUrl };
    if (next.enabled && !next.webhookUrl) throw new BadRequestException("A webhook URL is required to enable notifications.");
    if (next.webhookUrl && next.webhookUrl !== stored.webhookUrl) {
      try {
        await checkWebhookUrl(next.webhookUrl, this.webhookLookup);
      } catch (err) {
        throw new BadRequestException((err as Error).message);
      }
    }
    await this.prisma.notificationSettings.upsert({ where: { id: 1 }, create: { id: 1, ...next }, update: next });
    return { enabled: next.enabled, webhookUrl: maskWebhookUrl(next.webhookUrl) };
  }

  async testNotification(): Promise<{ ok: boolean; error?: string }> {
    return this.send((await this.storedNotifications()).webhookUrl, "Test message from ShipScope Flags");
  }

  /** Waits before the 2nd and 3rd attempt of a notification; tests shorten them. */
  notificationRetryDelaysMs = [2_000, 10_000];

  /**
   * Notifies about a prod change when notifications are on for all flags or for this one. Retries a failed send;
   * when every attempt fails, the audit log says so (the change itself stands).
   */
  private async notifyChange(flag: Flag, text: string): Promise<void> {
    const settings = await this.storedNotifications();
    if (!settings.enabled && !flag.notify) return;
    const result = await this.send(settings.webhookUrl, text, this.notificationRetryDelaysMs);
    if (!result.ok) {
      await this.audit(this.prisma, { actor: "shipscope", action: "notification-failed", flagKey: flag.key, environment: "prod", note: result.error });
    }
  }

  /** Posts `text` to the webhook; a network error, 429 or 5xx is retried after each of `retryDelaysMs`. */
  private async send(webhookUrl: string, text: string, retryDelaysMs: number[] = []): Promise<{ ok: boolean; error?: string }> {
    if (!webhookUrl) return { ok: false, error: "no webhook URL" };
    for (let attempt = 0; ; attempt++) {
      let retryable = true;
      try {
        // Checked again on every send: the host's DNS may now point somewhere it did not when the URL was saved.
        const url = await checkWebhookUrl(webhookUrl, this.webhookLookup).catch((err: Error) => {
          retryable = false;
          throw err;
        });
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
          signal: AbortSignal.timeout(4000),
          redirect: "manual", // a redirect could point into the internal network
        });
        if (res.ok) return { ok: true };
        retryable = res.status === 429 || res.status >= 500;
        throw new Error(`HTTP ${res.status}`);
      } catch (err) {
        const error = (err as Error).message;
        const delay = retryDelaysMs[attempt];
        if (!retryable || delay === undefined) {
          this.logger.warn(`Notification failed after ${attempt + 1} attempt(s): ${error}`);
          return { ok: false, error };
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  private async audit(db: Db, entry: Omit<AuditLogEntry, "id" | "timestamp">): Promise<void> {
    await db.auditLogEntry.create({ data: { ...entry, id: newAuditId(), timestamp: new Date().toISOString() } });
  }
}
