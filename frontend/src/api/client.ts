/**
 * Typed client for the flag-status service (FR-006/007/008, FR-011, FR-014).
 *
 * Two kinds of failure are kept apart:
 * - the API cannot be reached (network error, timeout, or 502/503/504 from the dev proxy when the backend is not
 *   running): `load()` falls back to the fixture data and the dashboard runs as a demo;
 * - the API answers with an error (a 409 from the promotion rules, a 400 from validation, a 500): the call throws
 *   an ApiError with the server's message, so the UI shows it instead of pretending the change was saved.
 *
 * The API knows the user from the session cookie set at sign-in (/api/auth/login); a 401 means the session is gone,
 * which the handler set with onUnauthorized() hears about (the app then shows the sign-in page again).
 */
import { auditLog as mockAuditLog, flags as mockFlags, services as mockServices } from "../data/mock";
import { DEFAULT_STALE_THRESHOLD_DAYS } from "../lib/businessLogic";
import type {
  AuditLogEntry,
  AuditLogPage,
  AuditLogQuery,
  Environment,
  Flag,
  FlagServiceBinding,
  FlagType,
  NotificationSettings,
  RuleSettings,
  Service,
  SignedInUser,
} from "../types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api";
const REQUEST_TIMEOUT_MS = 2000;
/** What a proxy answers when the API behind it is down. */
const UNAVAILABLE_STATUSES = new Set([502, 503, 504]);
/** Every change carries it: a header other sites cannot make the browser send, so the API can refuse forged requests. */
const CSRF_HEADERS = { "X-Requested-With": "shipscope" };

let unauthorized: () => void = () => {};

/** Called when the API answers 401 to a signed-in request: the session expired or was ended elsewhere. */
export function onUnauthorized(handler: () => void): void {
  unauthorized = handler;
}

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
    const reading = !init.method || init.method === "GET";
    res = await fetch(`${API_BASE_URL}${path}`, { ...init, headers: { ...init.headers, ...(reading ? {} : CSRF_HEADERS) }, signal: controller.signal });
  } catch (err) {
    throw new ApiUnavailableError((err as Error).message);
  } finally {
    clearTimeout(timer);
  }
  if (UNAVAILABLE_STATUSES.has(res.status)) throw new ApiUnavailableError(`${res.status} ${res.statusText}`.trim());
  if (res.status === 401 && path !== "/me") unauthorized();
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

export type FlagDetailsPatch = Pick<Partial<Flag>, "owner" | "reviewBy" | "tags" | "description" | "notify">;
export type BindingPatch = Pick<Partial<FlagServiceBinding>, "readMode" | "buildTimeValues" | "removedFromCode">;

/** A field set to undefined means "clear it"; JSON would drop it, so send null. */
const clearing = <T extends object>(patch: T) => Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v === undefined ? null : v]));
const flagPath = (flagKey: string) => `/flags/${encodeURIComponent(flagKey)}`;

/** A service with a new credential: the only time the API shows the credential. */
export interface IssuedCredential {
  service: Service;
  token: string;
}

/** How many of the latest audit entries the store keeps (the rest is fetched page by page). */
export const RECENT_AUDIT = 50;

export interface InitialData {
  flags: Flag[];
  services: Service[];
  auditLog: AuditLogEntry[];
  rules: RuleSettings;
  /** True when the API could not be reached and the data is the built-in fixture set. */
  demo: boolean;
}

export const api = {
  /** The signed-in user; an ApiError with status 401 when nobody is, ApiUnavailableError when the API is down. */
  me: () => call<SignedInUser>("/me"),

  /** Where the browser goes to sign in through the identity provider. */
  loginUrl: `${API_BASE_URL}/auth/login`,

  /** Ends the session; returns the identity provider's sign-out page, where the browser should go next. */
  logout: () => call<{ logoutUrl: string }>("/auth/logout", { method: "POST" }),

  /** Everything the dashboard shows. Falls back to the fixture data (demo mode) only when the API cannot be reached. */
  async load(): Promise<InitialData> {
    try {
      const [flags, services, audit, rules] = await Promise.all([
        call<Flag[]>("/flags"),
        call<Service[]>("/services"),
        api.listAuditLog({ limit: RECENT_AUDIT }),
        api.getRuleSettings(),
      ]);
      return { flags, services, auditLog: audit.entries, rules, demo: false };
    } catch (err) {
      if (!(err instanceof ApiUnavailableError)) throw err;
      console.info(`[shipscope] The API is not reachable (${err.message}); showing demo data.`);
      return { flags: mockFlags, services: mockServices, auditLog: mockAuditLog, rules: { staleThresholdDays: DEFAULT_STALE_THRESHOLD_DAYS }, demo: true };
    }
  },

  /** One page of the audit log, newest first; pass `nextCursor` as `before` for the next one. */
  listAuditLog: (query: AuditLogQuery = {}) => {
    const params = new URLSearchParams(Object.entries(query).flatMap(([k, v]) => (v === undefined || v === "" ? [] : [[k, String(v)]])));
    return call<AuditLogPage>(`/audit-log${params.size ? `?${params}` : ""}`);
  },

  getRuleSettings: () => call<RuleSettings>("/settings/rules"),

  saveRuleSettings: (rules: RuleSettings) => call<RuleSettings>("/settings/rules", withBody("PUT", rules)),

  getNotifications: () => call<NotificationSettings>("/settings/notifications"),

  saveNotifications: (settings: NotificationSettings) => call<NotificationSettings>("/settings/notifications", withBody("PUT", settings)),

  testNotification: () => call<{ ok: boolean; error?: string }>("/settings/notifications/test", { method: "POST" }),

  setEnvironmentState: (flagKey: string, environment: Environment, enabled: boolean) =>
    call<{ ok: true; flag: Flag }>(`${flagPath(flagKey)}/environments/${environment}`, withBody("PATCH", { enabled })),

  createFlag: (flag: NewFlag) => call<Flag>("/flags", withBody("POST", flag)),

  updateFlag: (flagKey: string, patch: FlagDetailsPatch) => call<Flag>(flagPath(flagKey), withBody("PATCH", clearing(patch))),

  updateBinding: (flagKey: string, serviceId: string, patch: BindingPatch) =>
    call<Flag>(`${flagPath(flagKey)}/services/${encodeURIComponent(serviceId)}`, withBody("PATCH", patch)),

  retireFlag: (flagKey: string) => call<{ ok: true }>(flagPath(flagKey), { method: "DELETE" }),

  registerService: (key: string, name: string) => call<IssuedCredential>("/services", withBody("POST", { key, name })),

  /** The old credential keeps working for 24 h, unless `revokePrevious` ends it at once. */
  rotateCredential: (serviceId: string, revokePrevious: boolean) =>
    call<IssuedCredential>(`/services/${encodeURIComponent(serviceId)}/credential`, withBody("POST", { revokePrevious })),
};
