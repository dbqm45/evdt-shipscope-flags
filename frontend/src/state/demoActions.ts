import type { Dispatch, SetStateAction } from "react";
import { canDisable, canEnable, canRetire } from "../lib/businessLogic";
import { ENVIRONMENTS, type AuditLogEntry, type Flag, type Service } from "../types";
import type { StoreActions } from "./useStore";

/** What the actions read and write in the store. */
export interface DemoContext {
  flags: Flag[];
  services: Service[];
  staleThresholdDays: number;
  /** The demo user of the role picked in the top bar. */
  actor: string;
  setFlags: Dispatch<SetStateAction<Flag[]>>;
  setStaleThresholdDays: Dispatch<SetStateAction<number>>;
  setAuditLog: Dispatch<SetStateAction<AuditLogEntry[]>>;
}

/**
 * The actions in demo mode, without the API: the shared rules run here and changes, with their audit entries, stay in
 * the browser. Credentials exist only on the server, so issuing them is refused.
 */
export function demoActions({ flags, services, staleThresholdDays, actor, setFlags, setStaleThresholdDays, setAuditLog }: DemoContext): StoreActions {
  const record = (entry: Omit<AuditLogEntry, "id" | "timestamp" | "actor">) =>
    setAuditLog((prev) => [
      { ...entry, actor, id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, timestamp: new Date().toISOString() },
      ...prev,
    ]);
  const serviceKey = (id: string) => services.find((s) => s.id === id)?.key;
  const noCredentials = async () => ({ ok: false, reason: "Credentials are issued by the API, which is not running (demo data)." });

  return {
    toggleEnvironment: async (flagKey, environment) => {
      const flag = flags.find((f) => f.key === flagKey);
      if (!flag) return { ok: false, reason: "Flag not found." };
      const enabled = !flag.environments[environment].enabled;
      const check = enabled ? canEnable(flag, environment, flags) : canDisable(flag, environment, flags);
      if (!check.allowed) {
        record({ action: "promotion-blocked", flagKey, environment, note: check.reason });
        return { ok: false, reason: check.reason };
      }
      const state = { enabled, updatedAt: new Date().toISOString(), updatedBy: actor };
      setFlags((prev) => prev.map((f) => (f.key === flagKey ? { ...f, environments: { ...f.environments, [environment]: state } } : f)));
      record({ action: enabled ? "env-enabled" : "env-disabled", flagKey, environment, from: enabled ? "off" : "on", to: enabled ? "on" : "off" });
      return { ok: true };
    },

    updateBinding: async (flagKey, serviceId, patch) => {
      setFlags((prev) =>
        prev.map((f) => (f.key !== flagKey ? f : { ...f, services: f.services.map((b) => (b.serviceId === serviceId ? { ...b, ...patch } : b)) })),
      );
      record({ action: "binding-updated", flagKey, serviceKey: serviceKey(serviceId), note: `updated ${Object.keys(patch).join(", ")}` });
      return { ok: true };
    },

    retireFlag: async (flagKey) => {
      const flag = flags.find((f) => f.key === flagKey);
      if (!flag) return { ok: false, reason: "Flag not found." };
      const check = canRetire(flag, flags, (id) => serviceKey(id) ?? id);
      if (!check.allowed) return { ok: false, reason: check.blockers[0] };
      setFlags((prev) => prev.filter((f) => f.key !== flagKey));
      record({ action: "flag-retired", flagKey });
      return { ok: true };
    },

    updateFlagMeta: async (flagKey, patch) => {
      setFlags((prev) => prev.map((f) => (f.key === flagKey ? { ...f, ...patch } : f)));
      record({ action: "flag-updated", flagKey, note: `updated ${Object.keys(patch).join(", ")}` });
      return { ok: true };
    },

    createFlag: async ({ key, description, type, serviceIds, dependsOn, owner, reviewBy, tags }) => {
      if (flags.some((f) => f.key === key)) return { ok: false, reason: "A flag with this key already exists." };
      const now = new Date().toISOString();
      const created: Flag = {
        id: `flag-${key}`,
        key,
        description,
        type,
        dependsOn: dependsOn || undefined,
        owner: owner || actor,
        reviewBy: reviewBy || undefined,
        tags: tags?.length ? tags : undefined,
        createdAt: now,
        createdBy: actor,
        environments: Object.fromEntries(ENVIRONMENTS.map((e) => [e, { enabled: false, updatedAt: now, updatedBy: actor }])) as Flag["environments"],
        services: serviceIds.map((serviceId) => ({ serviceId, readMode: "runtime" as const })),
      };
      setFlags((prev) => [created, ...prev]);
      record({ action: "flag-created", flagKey: key });
      for (const id of serviceIds) {
        const assigned = serviceKey(id);
        if (assigned) record({ action: "service-assigned", flagKey: key, serviceKey: assigned });
      }
      return { ok: true };
    },

    registerService: noCredentials,
    rotateCredential: noCredentials,

    setStaleThreshold: async (days) => {
      record({ action: "settings-updated", note: `stale threshold ${staleThresholdDays} → ${days} days` });
      setStaleThresholdDays(days);
      return { ok: true };
    },
  };
}
