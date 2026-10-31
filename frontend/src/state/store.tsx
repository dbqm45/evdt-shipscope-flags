import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api, failureReason } from "../api/client";
import { DEFAULT_STALE_THRESHOLD_DAYS } from "../lib/businessLogic";
import type { AuditLogEntry, Flag, Role, Service, SignedInUser } from "../types";
import { demoActions } from "./demoActions";
import { guardActions } from "./guardActions";
import { serverActions } from "./serverActions";
import { StoreContext, type StoreValue } from "./useStore";

/** Demo users, one per role: without the API (demo mode) there is no sign-in and the role is picked in the top bar. */
const DEMO_USER_BY_ROLE: Record<Role, string> = {
  viewer: "j.novak",
  editor: "m.chen",
  admin: "a.kowalska",
};

/**
 * The dashboard's state: what the API sent (or the demo data when it cannot be reached) and the actions that change it.
 * `user` is the signed-in user; without one (demo mode) the role can be switched freely.
 */
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
  const currentUser = user?.username ?? DEMO_USER_BY_ROLE[role];

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
    const actions = demo
      ? demoActions({ flags, services, staleThresholdDays, actor: currentUser, setFlags, setStaleThresholdDays, setAuditLog })
      : serverActions({ flags, setFlags, setServices, setStaleThresholdDays, setAuditLog });
    return {
      ...guardActions(role, actions),
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
      currentUser,
      staleThresholdDays,
    };
  }, [loading, demo, loadError, flags, services, auditLog, role, user, currentUser, staleThresholdDays]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
