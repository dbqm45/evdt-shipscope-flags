import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api, failureReason, RECENT_AUDIT, type IssuedCredential } from "../api/client";
import { canDisable, canEnable, canRetire, DEFAULT_STALE_THRESHOLD_DAYS } from "../lib/businessLogic";
import { canEditFlags } from "../lib/permissions";
import { ENVIRONMENTS, type AuditLogEntry, type Flag, type Role, type Service, type SignedInUser } from "../types";
import { StoreContext, type CredentialResult, type StoreValue, type ToggleResult } from "./useStore";

/** Demo users, one per role: without the API (demo mode) there is no sign-in and the role is picked in the top bar. */
const DEMO_USER_BY_ROLE: Record<Role, string> = {
  viewer: "j.novak",
  editor: "m.chen",
  admin: "a.kowalska",
};

/** `user` is the signed-in user; without one (demo mode) the role can be switched freely. */
export function StoreProvider({ user = null, children }: { user?: SignedInUser | null; children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [demo, setDemo] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [flags, setFlags] = useState<Flag[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [staleThresholdDays, setStaleThresholdDays] = useState(DEFAULT_STALE_THRESHOLD_DAYS);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [demoRole, setDemoRole] = useState<Role>("editor");
  const role = user?.role ?? demoRole;

  useEffect(() => {
    let cancelled = false;
    api
      .load()
      .then((data) => {
        if (cancelled) return;
        setFlags(data.flags);
        setServices(data.services);
        setStaleThresholdDays(data.rules.staleThresholdDays);
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
        .listAuditLog({ limit: RECENT_AUDIT })
        .then((page) => setAuditLog(page.entries))
        .catch(() => {});

    /** With the API: run the call, apply what the server returned, and show its audit log; a refusal becomes the reason. */
    const viaApi = async <T,>(callApi: () => Promise<T>, apply: (result: T) => void): Promise<ToggleResult> => {
      try {
        apply(await callApi());
        return { ok: true };
      } catch (err) {
        return { ok: false, reason: failureReason(err) };
      } finally {
        void refreshAuditLog();
      }
    };
    const replaceFlag = (stored: Flag) => setFlags((prev) => prev.map((f) => (f.key === stored.key ? stored : f)));
    // Only for the changes demo mode records in the browser: the API takes the author from the session.
    const actor = user?.username ?? DEMO_USER_BY_ROLE[role];

    const toggleEnvironment: StoreValue["toggleEnvironment"] = async (flagKey, environment) => {
      if (role === "viewer") return { ok: false, reason: "Viewers cannot change flag state." };

      const flag = flags.find((f) => f.key === flagKey);
      if (!flag) return { ok: false, reason: "Flag not found." };

      const currentlyEnabled = flag.environments[environment].enabled;
      const nextEnabled = !currentlyEnabled;

      if (!demo) {
        // The server applies the rules and records the change; show what it stored, or why it refused.
        try {
          const { flag: stored } = await api.setEnvironmentState(flagKey, environment, nextEnabled);
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
            actor,
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
                    updatedBy: actor,
                  },
                },
              },
        ),
      );

      registerAuditEntry({
        actor,
        action: nextEnabled ? "env-enabled" : "env-disabled",
        flagKey,
        environment,
        from: currentlyEnabled ? "on" : "off",
        to: nextEnabled ? "on" : "off",
      });
      return { ok: true };
    };

    const updateBinding: StoreValue["updateBinding"] = async (flagKey, serviceId, patch) => {
      if (!canEditFlags(role)) return { ok: false, reason: "Only Editors and Admins can change how a service reads a flag." };
      if (!demo) return viaApi(() => api.updateBinding(flagKey, serviceId, patch), replaceFlag);
      const svc = services.find((s) => s.id === serviceId);
      const changed = Object.keys(patch).join(", ");
      setFlags((prev) =>
        prev.map((f) => (f.key !== flagKey ? f : { ...f, services: f.services.map((b) => (b.serviceId === serviceId ? { ...b, ...patch } : b)) })),
      );
      registerAuditEntry({
        actor,
        action: "binding-updated",
        flagKey,
        serviceKey: svc?.key,
        note: `updated ${changed}`,
      });
      return { ok: true };
    };

    const retireFlag: StoreValue["retireFlag"] = async (flagKey) => {
      if (!canEditFlags(role)) return { ok: false, reason: "Only Editors and Admins can retire flags." };
      if (!demo)
        return viaApi(
          () => api.retireFlag(flagKey),
          () => setFlags((prev) => prev.filter((f) => f.key !== flagKey)),
        );
      const flag = flags.find((f) => f.key === flagKey);
      if (!flag) return { ok: false, reason: "Flag not found." };
      const check = canRetire(flag, flags, (id) => services.find((s) => s.id === id)?.key ?? id);
      if (!check.allowed) return { ok: false, reason: check.blockers[0] };
      setFlags((prev) => prev.filter((f) => f.key !== flagKey));
      registerAuditEntry({ actor, action: "flag-retired", flagKey });
      return { ok: true };
    };

    const updateFlagMeta: StoreValue["updateFlagMeta"] = async (flagKey, patch) => {
      if (!canEditFlags(role)) return { ok: false, reason: "Only Editors and Admins can edit flag details." };
      if (!demo) return viaApi(() => api.updateFlag(flagKey, patch), replaceFlag);
      setFlags((prev) => prev.map((f) => (f.key === flagKey ? { ...f, ...patch } : f)));
      registerAuditEntry({ actor, action: "flag-updated", flagKey, note: `updated ${Object.keys(patch).join(", ")}` });
      return { ok: true };
    };

    const createFlag: StoreValue["createFlag"] = async (input) => {
      const { key, description, type, serviceIds, dependsOn, owner, reviewBy, tags } = input;
      if (!canEditFlags(role)) return { ok: false, reason: "Only Editors and Admins can create flags." };
      if (!key.trim()) return { ok: false, reason: "Flag key is required." };
      if (!demo)
        return viaApi(
          () => api.createFlag(input),
          (created) => setFlags((prev) => [created, ...prev]),
        );
      if (flags.some((f) => f.key === key)) return { ok: false, reason: "A flag with this key already exists." };

      const now = new Date().toISOString();
      const newFlag: Flag = {
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

      setFlags((prev) => [newFlag, ...prev]);
      registerAuditEntry({ actor, action: "flag-created", flagKey: key });
      serviceIds.forEach((serviceId) => {
        const svc = services.find((s) => s.id === serviceId);
        if (svc) registerAuditEntry({ actor, action: "service-assigned", flagKey: key, serviceKey: svc.key });
      });
      return { ok: true };
    };

    /** Credentials exist only on the server, so these need the API; the result carries the new credential. */
    const issueCredential = async (call: () => Promise<IssuedCredential>): Promise<CredentialResult> => {
      if (role !== "admin") return { ok: false, reason: "Only Admins can register services and rotate their credentials." };
      if (demo) return { ok: false, reason: "Credentials are issued by the API, which is not running (demo data)." };
      let token: string | undefined;
      const result = await viaApi(call, (issued) => {
        token = issued.token;
        setServices((prev) =>
          prev.some((s) => s.id === issued.service.id) ? prev.map((s) => (s.id === issued.service.id ? issued.service : s)) : [...prev, issued.service],
        );
      });
      return { ...result, token };
    };
    const registerService: StoreValue["registerService"] = (key, name) => {
      if (!key.trim()) return Promise.resolve({ ok: false, reason: "Service key is required." });
      return issueCredential(() => api.registerService(key.trim(), name.trim()));
    };
    const rotateCredential: StoreValue["rotateCredential"] = (serviceId, revokePrevious) =>
      issueCredential(() => api.rotateCredential(serviceId, revokePrevious));

    const setStaleThreshold: StoreValue["setStaleThreshold"] = async (days) => {
      if (role !== "admin") return { ok: false, reason: "Only Admins can change the rules." };
      if (!Number.isInteger(days) || days < 1 || days > 365) return { ok: false, reason: "Enter a whole number of days from 1 to 365." };
      if (!demo)
        return viaApi(
          () => api.saveRuleSettings({ staleThresholdDays: days }),
          (saved) => setStaleThresholdDays(saved.staleThresholdDays),
        );
      registerAuditEntry({ actor, action: "settings-updated", note: `stale threshold ${staleThresholdDays} → ${days} days` });
      setStaleThresholdDays(days);
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
      setRole: (next) => {
        if (!user) setDemoRole(next);
      },
      user,
      currentUser: actor,
      toggleEnvironment,
      updateBinding,
      retireFlag,
      updateFlagMeta,
      registerAuditEntry,
      createFlag,
      registerService,
      rotateCredential,
      staleThresholdDays,
      setStaleThreshold,
    };
  }, [loading, demo, loadError, flags, services, auditLog, role, user, staleThresholdDays]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
