export type Environment = "test" | "qa" | "prod";

export const ENVIRONMENTS: Environment[] = ["test", "qa", "prod"];

export type FlagType = "release" | "feature";

/**
 * How a service reads a flag.
 * - runtime: only from the flag endpoint
 * - build-time: only from a constant baked into its code
 * - both: constant in code + runtime value; runtime wins while the flag exists, the constant is the fallback
 */
export type ReadMode = "build-time" | "runtime" | "both";

export type Role = "viewer" | "editor" | "admin";

/** The signed-in dashboard user (GET /api/me); the role comes from the identity provider. */
export interface SignedInUser {
  /** The name the audit log records for this user's changes. */
  username: string;
  name: string;
  email?: string;
  role: Role;
}

export interface EnvironmentState {
  enabled: boolean;
  updatedAt: string;
  updatedBy: string;
}

export interface Service {
  id: string;
  key: string;
  name: string;
  registeredAt: string;
  registeredBy: string;
  /** False until the service has been issued a credential (services from before 0.4 start without one). */
  hasCredential: boolean;
  /** "rotating" while the credential replaced by the last rotation still works (until previousCredentialExpiresAt). */
  credentialStatus: "active" | "rotating";
  previousCredentialExpiresAt?: string;
  credentialLastRotated: string;
  /** Last time the service read its flags with its own credential, in any environment; missing = never. */
  lastCheckInAt?: string;
  /** Last read per environment; an environment the service never read from is missing. */
  checkIns: Partial<Record<Environment, string>>;
}

export interface FlagServiceBinding {
  serviceId: string;
  readMode: ReadMode;
  /** Value baked into this service's code per environment. Entered by hand; missing = not recorded yet. */
  buildTimeValues?: Partial<Record<Environment, boolean>>;
  /** The flag reference has been deleted from this service's code. */
  removedFromCode?: boolean;
}

export interface Flag {
  id: string;
  key: string;
  description: string;
  type: FlagType;
  createdAt: string;
  createdBy: string;
  environments: Record<Environment, EnvironmentState>;
  services: FlagServiceBinding[];
  /** Key of another flag that must already be ON in an environment before this one can be enabled there (e.g. frontend flag depends on its backend flag). */
  dependsOn?: string;
  /** Person or team accountable for the flag. */
  owner?: string;
  /** ISO date by which someone should re-check whether the flag is still needed. */
  reviewBy?: string;
  /** Free-form labels, e.g. the business domain ("checkout", "orders"). */
  tags?: string[];
  /** Notify about every prod change of this flag, also when notifications are not on for all flags. */
  notify?: boolean;
}

/** Where a flag is in its life: derived from environment state, never stored. */
export type LifecycleStage = "new" | "testing" | "live" | "cleanup";

export const AUDIT_ACTIONS = [
  "flag-created",
  "env-enabled",
  "env-disabled",
  "promotion-blocked",
  "service-assigned",
  "service-registered",
  "credential-rotated",
  "binding-updated",
  "flag-retired",
  "flag-updated",
  "notification-failed",
  "audit-log-pruned",
  "settings-updated",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actor: string;
  action: AuditAction;
  flagKey?: string;
  serviceKey?: string;
  environment?: Environment;
  from?: string;
  to?: string;
  note?: string;
}

/** One page of the audit log, newest first (GET /api/audit-log). */
export interface AuditLogPage {
  entries: AuditLogEntry[];
  /** Pass as `before` to get the next, older page; missing = this is the last page. */
  nextCursor?: string;
}

/** Filters of GET /api/audit-log; every one is optional. `q` searches actor, flag, service and note. */
export interface AuditLogQuery {
  limit?: number;
  before?: string;
  flagKey?: string;
  serviceKey?: string;
  action?: AuditAction;
  actor?: string;
  q?: string;
}

/** Thresholds of the business rules an Admin can change (Settings). */
export interface RuleSettings {
  /** Days a release flag stays ON everywhere before it becomes a candidate for removal. */
  staleThresholdDays: number;
}

export interface NotificationSettings {
  /** Notify about prod changes of every flag; flags with `notify` are notified also when this is off. */
  enabled: boolean;
  /** Slack-compatible incoming webhook (POST {"text": "..."}; any URL accepting JSON works); gets a message whenever a flag changes in prod. */
  webhookUrl: string;
}

export interface PromotionCheck {
  allowed: boolean;
  reason?: string;
  blockedBy?: Environment;
  blockedByFlag?: string;
}
