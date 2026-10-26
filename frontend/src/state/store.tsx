import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, failureReason } from "../api/client";
import { canDisable, canEnable, canRetire } from "../lib/businessLogic";
import { canEditFlags } from "../lib/permissions";
import { ENVIRONMENTS, type AuditLogEntry, type Environment, type Flag, type FlagServiceBinding, type FlagType, type Role, type Service } from "../types";

interface ToggleResult {
  ok: boolean;
  reason?: string;
}

interface StoreValue {
  loading: boolean;
  /** The API could not be reached: the data is the built-in demo set and changes stay in this browser. */
  demo: boolean;
  /** The API answered the initial load with an error; nothing is shown. */
  loadError: string | null;
  flags: Flag[];
  services: Service[];
  auditLog: AuditLogEntry[];
  role: Role;
  setRole: (role: Role) => void;
  currentUser: string;
  toggleEnvironment: (flagKey: string, environment: Environment) => Promise<ToggleResult>;
  updateBinding: (flagKey: string, serviceId: string, patch: Partial<FlagServiceBinding>) => ToggleResult;
  retireFlag: (flagKey: string) => ToggleResult;
  registerAuditEntry: (entry: Omit<AuditLogEntry, "id" | "timestamp">) => void;
  createFlag: (input: {
    key: string;
    description: string;
    type: FlagType;
    serviceIds: string[];
    dependsOn?: string;
    owner?: string;
    reviewBy?: string;
    tags?: string[];
  }) => ToggleResult;
  updateFlagMeta: (flagKey: string, patch: Pick<Partial<Flag>, "owner" | "reviewBy" | "tags" | "description">) => ToggleResult;
}

const StoreContext = createContext<StoreValue | null>(null);

const CURRENT_USER_BY_ROLE: Record<Role, string> = {
  viewer: "j.novak",
  editor: "m.chen",
  admin: "a.kowalska",
};

export function StoreProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [demo, setDemo] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [flags, setFlags] = useState<Flag[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [role, setRole] = useState<Role>("editor");

  useEffect(() => {
    let cancelled = false;
    api
      .load()
      .then((data) => {
        if (cancelled) return;
        setFlags(data.flags);
        setServices(data.services);
        setAuditLog(data.auditLog);
        setDemo(data.demo);
      })
      .catch((err: unknown) => !cancelled && setLoadError(failureReason(err)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<StoreValue>(() => {
    const registerAuditEntry: StoreValue["registerAuditEntry"] = (entry) => {
      setAuditLog((prev) => [{ ...entry, id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, timestamp: new Date().toISOString() }, ...prev]);
    };

    /** The server's audit log is the record once a change went to the API, blocked attempts included. */
    const refreshAuditLog = () =>
      api
        .listAuditLog()
        .then(setAuditLog)
        .catch(() => {});

    const toggleEnvironment: StoreValue["toggleEnvironment"] = async (flagKey, environment) => {
      if (role === "viewer") return { ok: false, reason: "Viewers cannot change flag state." };

      const flag = flags.find((f) => f.key === flagKey);
      if (!flag) return { ok: false, reason: "Flag not found." };

      const currentlyEnabled = flag.environments[environment].enabled;
      const nextEnabled = !currentlyEnabled;

      if (!demo) {
        // The server applies the rules and records the change; show what it stored, or why it refused.
        try {
          const { flag: stored } = await api.setEnvironmentState(flagKey, environment, nextEnabled, CURRENT_USER_BY_ROLE[role]);
          setFlags((prev) => prev.map((f) => (f.key === flagKey ? stored : f)));
          return { ok: true };
        } catch (err) {
          return { ok: false, reason: failureReason(err) };
        } finally {
          void refreshAuditLog();
        }
      }

      {
        const check = nextEnabled ? canEnable(flag, environment, flags) : canDisable(flag, environment, flags);
        if (!check.allowed) {
          registerAuditEntry({
            actor: CURRENT_USER_BY_ROLE[role],
            action: "promotion-blocked",
            flagKey,
            environment,
            note: check.reason,
          });
          return { ok: false, reason: check.reason };
        }
      }

      setFlags((prev) =>
        prev.map((f) =>
          f.key !== flagKey
            ? f
            : {
                ...f,
                environments: {
                  ...f.environments,
                  [environment]: {
                    enabled: nextEnabled,
                    updatedAt: new Date().toISOString(),
                    updatedBy: CURRENT_USER_BY_ROLE[role],
                  },
                },
              },
        ),
      );

      registerAuditEntry({
        actor: CURRENT_USER_BY_ROLE[role],
        action: nextEnabled ? "env-enabled" : "env-disabled",
        flagKey,
        environment,
        from: currentlyEnabled ? "on" : "off",
        to: nextEnabled ? "on" : "off",
      });
      return { ok: true };
    };

    const updateBinding: StoreValue["updateBinding"] = (flagKey, serviceId, patch) => {
      if (!canEditFlags(role)) return { ok: false, reason: "Only Editors and Admins can change how a service reads a flag." };
      const svc = services.find((s) => s.id === serviceId);
      const changed = Object.keys(patch).join(", ");
      setFlags((prev) =>
        prev.map((f) => (f.key !== flagKey ? f : { ...f, services: f.services.map((b) => (b.serviceId === serviceId ? { ...b, ...patch } : b)) })),
      );
      registerAuditEntry({
        actor: CURRENT_USER_BY_ROLE[role],
        action: "binding-updated",
        flagKey,
        serviceKey: svc?.key,
        note: `updated ${changed}`,
      });
      return { ok: true };
    };

    const retireFlag: StoreValue["retireFlag"] = (flagKey) => {
      if (!canEditFlags(role)) return { ok: false, reason: "Only Editors and Admins can retire flags." };
      const flag = flags.find((f) => f.key === flagKey);
      if (!flag) return { ok: false, reason: "Flag not found." };
      const check = canRetire(flag, flags, (id) => services.find((s) => s.id === id)?.key ?? id);
      if (!check.allowed) return { ok: false, reason: check.blockers[0] };
      setFlags((prev) => prev.filter((f) => f.key !== flagKey));
      registerAuditEntry({ actor: CURRENT_USER_BY_ROLE[role], action: "flag-retired", flagKey });
      return { ok: true };
    };

    const updateFlagMeta: StoreValue["updateFlagMeta"] = (flagKey, patch) => {
      if (!canEditFlags(role)) return { ok: false, reason: "Only Editors and Admins can edit flag details." };
      setFlags((prev) => prev.map((f) => (f.key === flagKey ? { ...f, ...patch } : f)));
      registerAuditEntry({ actor: CURRENT_USER_BY_ROLE[role], action: "flag-updated", flagKey, note: `updated ${Object.keys(patch).join(", ")}` });
      return { ok: true };
    };

    const createFlag: StoreValue["createFlag"] = ({ key, description, type, serviceIds, dependsOn, owner, reviewBy, tags }) => {
      if (!canEditFlags(role)) return { ok: false, reason: "Only Editors and Admins can create flags." };
      if (!key.trim()) return { ok: false, reason: "Flag key is required." };
      if (flags.some((f) => f.key === key)) return { ok: false, reason: "A flag with this key already exists." };

      const now = new Date().toISOString();
      const newFlag: Flag = {
        id: `flag-${key}`,
        key,
        description,
        type,
        dependsOn: dependsOn || undefined,
        owner: owner || CURRENT_USER_BY_ROLE[role],
        reviewBy: reviewBy || undefined,
        tags: tags?.length ? tags : undefined,
        createdAt: now,
        createdBy: CURRENT_USER_BY_ROLE[role],
        environments: Object.fromEntries(
          ENVIRONMENTS.map((e) => [e, { enabled: false, updatedAt: now, updatedBy: CURRENT_USER_BY_ROLE[role] }]),
        ) as Flag["environments"],
        services: serviceIds.map((serviceId) => ({ serviceId, readMode: "runtime" as const, lastCheckInAt: now, driftSuspected: false })),
      };

      setFlags((prev) => [newFlag, ...prev]);
      registerAuditEntry({ actor: CURRENT_USER_BY_ROLE[role], action: "flag-created", flagKey: key });
      serviceIds.forEach((serviceId) => {
        const svc = services.find((s) => s.id === serviceId);
        if (svc) registerAuditEntry({ actor: CURRENT_USER_BY_ROLE[role], action: "service-assigned", flagKey: key, serviceKey: svc.key });
      });
      return { ok: true };
    };

    return {
      loading,
      demo,
      loadError,
      flags,
      services,
      auditLog,
      role,
      setRole,
      currentUser: CURRENT_USER_BY_ROLE[role],
      toggleEnvironment,
      updateBinding,
      retireFlag,
      updateFlagMeta,
      registerAuditEntry,
      createFlag,
    };
  }, [loading, demo, loadError, flags, services, auditLog, role]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
