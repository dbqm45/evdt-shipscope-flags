/**
 * Typed client for the flag-status service (FR-006/007/008, FR-011, FR-014).
 *
 * Two kinds of failure are kept apart:
 * - the API cannot be reached (network error, timeout, or 502/503/504 from the dev proxy when the backend is not
 *   running): `load()` falls back to the fixture data and the dashboard runs as a demo;
 * - the API answers with an error (a 409 from the promotion rules, a 400 from validation, a 500): the call throws
 *   an ApiError with the server's message, so the UI shows it instead of pretending the change was saved.
 */
import { auditLog as mockAuditLog, flags as mockFlags, services as mockServices } from "../data/mock";
import type { AuditLogEntry, Environment, Flag, FlagServiceBinding, FlagType, NotificationSettings, Service } from "../types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api";
const REQUEST_TIMEOUT_MS = 2000;
/** What a proxy answers when the API behind it is down. */
const UNAVAILABLE_STATUSES = new Set([502, 503, 504]);

/** The API could not be reached at all. */
export class ApiUnavailableError extends Error {}

/** The API answered with an error status; `message` is the server's own reason. */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** The reason to show for a failed API call. */
export function failureReason(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof ApiUnavailableError) return "The API is not reachable — nothing was changed.";
  return (err as Error).message ?? String(err);
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string | string[] };
    if (Array.isArray(body.message)) return body.message.join(" ");
    if (body.message) return body.message;
  } catch {
    // not JSON
  }
  return `${res.status} ${res.statusText}`.trim();
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, { ...init, signal: controller.signal });
  } catch (err) {
    throw new ApiUnavailableError((err as Error).message);
  } finally {
    clearTimeout(timer);
  }
  if (UNAVAILABLE_STATUSES.has(res.status)) throw new ApiUnavailableError(`${res.status} ${res.statusText}`.trim());
  if (!res.ok) throw new ApiError(await errorMessage(res), res.status);
  return (await res.json()) as T;
}

const withBody = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export interface NewFlag {
  key: string;
  description: string;
  type: FlagType;
  serviceIds: string[];
  dependsOn?: string;
  owner?: string;
  reviewBy?: string;
  tags?: string[];
}

export type FlagDetailsPatch = Pick<Partial<Flag>, "owner" | "reviewBy" | "tags" | "description">;
export type BindingPatch = Pick<Partial<FlagServiceBinding>, "readMode" | "buildTimeValues" | "removedFromCode">;

/** A field set to undefined means "clear it"; JSON would drop it, so send null. */
const clearing = <T extends object>(patch: T) => Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v === undefined ? null : v]));
const flagPath = (flagKey: string) => `/flags/${encodeURIComponent(flagKey)}`;

export interface InitialData {
  flags: Flag[];
  services: Service[];
  auditLog: AuditLogEntry[];
  /** True when the API could not be reached and the data is the built-in fixture set. */
  demo: boolean;
}

export const api = {
  /** Everything the dashboard shows. Falls back to the fixture data (demo mode) only when the API cannot be reached. */
  async load(): Promise<InitialData> {
    try {
      const [flags, services, auditLog] = await Promise.all([call<Flag[]>("/flags"), call<Service[]>("/services"), call<AuditLogEntry[]>("/audit-log")]);
      return { flags, services, auditLog, demo: false };
    } catch (err) {
      if (!(err instanceof ApiUnavailableError)) throw err;
      console.info(`[shipscope] The API is not reachable (${err.message}); showing demo data.`);
      return { flags: mockFlags, services: mockServices, auditLog: mockAuditLog, demo: true };
    }
  },

  listAuditLog: () => call<AuditLogEntry[]>("/audit-log"),

  getNotifications: () => call<NotificationSettings>("/settings/notifications"),

  saveNotifications: (settings: NotificationSettings) => call<NotificationSettings>("/settings/notifications", withBody("PUT", settings)),

  testNotification: () => call<{ ok: boolean; error?: string }>("/settings/notifications/test", { method: "POST" }),

  setEnvironmentState: (flagKey: string, environment: Environment, enabled: boolean, actor: string) =>
    call<{ ok: true; flag: Flag }>(`${flagPath(flagKey)}/environments/${environment}`, withBody("PATCH", { enabled, actor })),

  createFlag: (flag: NewFlag, actor: string) => call<Flag>("/flags", withBody("POST", { ...flag, actor })),

  updateFlag: (flagKey: string, patch: FlagDetailsPatch, actor: string) => call<Flag>(flagPath(flagKey), withBody("PATCH", { ...clearing(patch), actor })),

  updateBinding: (flagKey: string, serviceId: string, patch: BindingPatch, actor: string) =>
    call<Flag>(`${flagPath(flagKey)}/services/${encodeURIComponent(serviceId)}`, withBody("PATCH", { ...patch, actor })),

  retireFlag: (flagKey: string, actor: string) => call<{ ok: true }>(flagPath(flagKey), withBody("DELETE", { actor })),
};
