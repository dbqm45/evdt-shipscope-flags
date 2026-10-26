import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { canDisable, canEnable } from "./shared/rules.js";
import { auditLog as seedAudit, flags as seedFlags, services as seedServices } from "./shared/seed.js";
import { ENVIRONMENTS, type AuditLogEntry, type Environment, type Flag, type Service } from "./shared/types.js";

export interface NotificationSettings {
  enabled: boolean;
  /** Slack-compatible incoming webhook (POST {"text": "..."}); any URL accepting JSON works. */
  webhookUrl: string;
}

interface State {
  flags: Flag[];
  services: Service[];
  auditLog: AuditLogEntry[];
  notifications: NotificationSettings;
}

@Injectable()
export class FlagsService {
  private readonly logger = new Logger(FlagsService.name);
  private readonly file = process.env.FLAGS_DATA_FILE ?? "data/state.json";
  private state: State = this.load();

  private load(): State {
    if (existsSync(this.file)) {
      try {
        return JSON.parse(readFileSync(this.file, "utf8")) as State;
      } catch (err) {
        this.logger.warn(`Could not read ${this.file} (${(err as Error).message}); starting from seed data.`);
      }
    }
    return {
      flags: structuredClone(seedFlags),
      services: structuredClone(seedServices),
      auditLog: structuredClone(seedAudit),
      notifications: { enabled: false, webhookUrl: process.env.NOTIFY_WEBHOOK_URL ?? "" },
    };
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(this.state, null, 2));
    } catch (err) {
      this.logger.warn(`Could not persist state to ${this.file}: ${(err as Error).message}`);
    }
  }

  listFlags(): Flag[] {
    return this.state.flags;
  }

  listServices(): Service[] {
    return this.state.services;
  }

  listAuditLog(): AuditLogEntry[] {
    return this.state.auditLog;
  }

  /** Consumer view: `{ flagKey: boolean }` for one environment, optionally only flags bound to a service. */
  evaluate(env: Environment, serviceKey?: string): Record<string, boolean> {
    const service = serviceKey ? this.state.services.find((s) => s.key === serviceKey) : undefined;
    if (serviceKey && !service) throw new NotFoundException(`Unknown service "${serviceKey}".`);
    const result: Record<string, boolean> = {};
    for (const flag of this.state.flags) {
      if (service && !flag.services.some((b) => b.serviceId === service.id)) continue;
      result[flag.key] = flag.environments[env].enabled;
    }
    return result;
  }

  async setEnvironment(flagKey: string, env: Environment, enabled: boolean, actor: string): Promise<Flag> {
    const flag = this.state.flags.find((f) => f.key === flagKey);
    if (!flag) throw new NotFoundException(`Flag "${flagKey}" not found.`);
    const current = flag.environments[env].enabled;
    if (current === enabled) return flag;

    const check = enabled ? canEnable(flag, env, this.state.flags) : canDisable(flag, env, this.state.flags);
    if (!check.allowed) {
      this.audit({ actor, action: "promotion-blocked", flagKey, environment: env, note: check.reason });
      this.save();
      throw new ConflictException(check.reason);
    }

    flag.environments[env] = { enabled, updatedAt: new Date().toISOString(), updatedBy: actor };
    this.audit({
      actor,
      action: enabled ? "env-enabled" : "env-disabled",
      flagKey,
      environment: env,
      from: current ? "on" : "off",
      to: enabled ? "on" : "off",
    });
    this.save();
    if (env === "prod") void this.notify(`:rotating_light: *${flagKey}* was turned *${enabled ? "ON" : "OFF"}* in *PROD* by ${actor}`);
    return flag;
  }

  getNotifications(): NotificationSettings {
    return this.state.notifications;
  }

  setNotifications(input: Partial<NotificationSettings>): NotificationSettings {
    const next = { ...this.state.notifications, ...input };
    if (next.enabled && !/^https?:\/\//.test(next.webhookUrl)) {
      throw new BadRequestException("A valid http(s) webhook URL is required to enable notifications.");
    }
    this.state.notifications = next;
    this.save();
    return next;
  }

  async testNotification(): Promise<{ ok: boolean; error?: string }> {
    return this.notify("Test message from ShipScope Flags", true);
  }

  private async notify(text: string, force = false): Promise<{ ok: boolean; error?: string }> {
    const { enabled, webhookUrl } = this.state.notifications;
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

  private audit(entry: Omit<AuditLogEntry, "id" | "timestamp">): void {
    this.state.auditLog.unshift({ ...entry, id: `srv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, timestamp: new Date().toISOString() });
  }
}

export function isEnvironment(value: string): value is Environment {
  return (ENVIRONMENTS as string[]).includes(value);
}
