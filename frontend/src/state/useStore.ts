import { createContext, useContext } from "react";
import type { BindingPatch, FlagDetailsPatch, NewFlag } from "../api/client";
import type { AuditLogEntry, Environment, Flag, Role, Service } from "../types";

// The store's shape and the hook to read it; StoreProvider (store.tsx) fills it.

export interface ToggleResult {
  ok: boolean;
  reason?: string;
}

/** `token` is the new credential, to be shown once. */
export interface CredentialResult extends ToggleResult {
  token?: string;
}

export interface StoreValue {
  loading: boolean;
  /** The API could not be reached: the data is the built-in demo set and changes stay in this browser. */
  demo: boolean;
  /** The API answered the initial load with an error; nothing is shown. */
  loadError: string | null;
  flags: Flag[];
  services: Service[];
  /** The latest audit entries (all of them in demo mode); refreshed after every change made through the API. */
  auditLog: AuditLogEntry[];
  role: Role;
  setRole: (role: Role) => void;
  currentUser: string;
  toggleEnvironment: (flagKey: string, environment: Environment) => Promise<ToggleResult>;
  updateBinding: (flagKey: string, serviceId: string, patch: BindingPatch) => Promise<ToggleResult>;
  retireFlag: (flagKey: string) => Promise<ToggleResult>;
  registerAuditEntry: (entry: Omit<AuditLogEntry, "id" | "timestamp">) => void;
  createFlag: (input: NewFlag) => Promise<ToggleResult>;
  updateFlagMeta: (flagKey: string, patch: FlagDetailsPatch) => Promise<ToggleResult>;
  registerService: (key: string, name: string) => Promise<CredentialResult>;
  rotateCredential: (serviceId: string, revokePrevious: boolean) => Promise<CredentialResult>;
}

export const StoreContext = createContext<StoreValue | null>(null);

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
