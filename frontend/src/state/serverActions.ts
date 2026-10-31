import type { Dispatch, SetStateAction } from "react";
import { api, failureReason, RECENT_AUDIT, type IssuedCredential } from "../api/client";
import type { AuditLogEntry, Flag, Service } from "../types";
import type { StoreActions, ToggleResult } from "./useStore";

/** What the actions read and write in the store. */
export interface ServerContext {
  flags: Flag[];
  setFlags: Dispatch<SetStateAction<Flag[]>>;
  setServices: Dispatch<SetStateAction<Service[]>>;
  setStaleThresholdDays: Dispatch<SetStateAction<number>>;
  setAuditLog: Dispatch<SetStateAction<AuditLogEntry[]>>;
}

/**
 * The actions with the API: the server applies the rules, records the change and its author; the dashboard shows what
 * the server stored, or its reason for refusing, and then the server's audit log (blocked attempts included).
 */
export function serverActions({ flags, setFlags, setServices, setStaleThresholdDays, setAuditLog }: ServerContext): StoreActions {
  const refreshAuditLog = () =>
    api
      .listAuditLog({ limit: RECENT_AUDIT })
      .then((page) => setAuditLog(page.entries))
      .catch(() => {});

  const run = async <T>(callApi: () => Promise<T>, apply: (result: T) => void): Promise<ToggleResult> => {
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

  /** The result carries the new credential, shown once. */
  const issue = async (callApi: () => Promise<IssuedCredential>) => {
    let token: string | undefined;
    const result = await run(callApi, (issued) => {
      token = issued.token;
      setServices((prev) =>
        prev.some((s) => s.id === issued.service.id) ? prev.map((s) => (s.id === issued.service.id ? issued.service : s)) : [...prev, issued.service],
      );
    });
    return { ...result, token };
  };

  return {
    toggleEnvironment: async (flagKey, environment) => {
      const flag = flags.find((f) => f.key === flagKey);
      if (!flag) return { ok: false, reason: "Flag not found." };
      return run(
        () => api.setEnvironmentState(flagKey, environment, !flag.environments[environment].enabled),
        ({ flag: stored }) => replaceFlag(stored),
      );
    },
    updateBinding: (flagKey, serviceId, patch) => run(() => api.updateBinding(flagKey, serviceId, patch), replaceFlag),
    retireFlag: (flagKey) =>
      run(
        () => api.retireFlag(flagKey),
        () => setFlags((prev) => prev.filter((f) => f.key !== flagKey)),
      ),
    updateFlagMeta: (flagKey, patch) => run(() => api.updateFlag(flagKey, patch), replaceFlag),
    createFlag: (input) =>
      run(
        () => api.createFlag(input),
        (created) => setFlags((prev) => [created, ...prev]),
      ),
    registerService: (key, name) => issue(() => api.registerService(key, name)),
    rotateCredential: (serviceId, revokePrevious) => issue(() => api.rotateCredential(serviceId, revokePrevious)),
    setStaleThreshold: (days) =>
      run(
        () => api.saveRuleSettings({ staleThresholdDays: days }),
        (saved) => setStaleThresholdDays(saved.staleThresholdDays),
      ),
  };
}
