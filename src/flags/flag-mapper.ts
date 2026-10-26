import type { Prisma } from "../generated/prisma/client.js";
import type { AuditLogEntry, Environment, EnvironmentState, Flag, FlagServiceBinding, ReadMode, Service } from "@shipscope/shared/types";

// Converts between database rows and the shapes the API returns (@shipscope/shared/types, also used by the
// frontend). Optional fields stay absent instead of null, as the dashboard and the seed data expect.

export const FLAG_INCLUDE = { environments: true, services: { orderBy: { position: "asc" } } } satisfies Prisma.FlagInclude;
type FlagRow = Prisma.FlagGetPayload<{ include: typeof FLAG_INCLUDE }>;
export const SERVICE_INCLUDE = { checkIns: true } satisfies Prisma.ServiceInclude;
type ServiceRow = Prisma.ServiceGetPayload<{ include: typeof SERVICE_INCLUDE }>;
type AuditRow = Prisma.AuditLogEntryGetPayload<object>;

const iso = (d: Date) => d.toISOString();

// The enum value "build-time" is not a valid identifier, so the schema calls it build_time and maps it.
export const toDbReadMode = (mode: ReadMode) => (mode === "build-time" ? "build_time" : mode);
const fromDbReadMode = (mode: FlagRow["services"][number]["readMode"]): ReadMode => (mode === "build_time" ? "build-time" : mode);

export function toFlag(row: FlagRow): Flag {
  const environments = Object.fromEntries(
    row.environments.map((e) => [e.environment, { enabled: e.enabled, updatedAt: iso(e.updatedAt), updatedBy: e.updatedBy } satisfies EnvironmentState]),
  ) as Record<Environment, EnvironmentState>;
  const services = row.services.map((b) => {
    const binding: FlagServiceBinding = {
      serviceId: b.serviceId,
      readMode: fromDbReadMode(b.readMode),
    };
    if (b.buildTimeValues !== null) binding.buildTimeValues = b.buildTimeValues as FlagServiceBinding["buildTimeValues"];
    if (b.removedFromCode !== null) binding.removedFromCode = b.removedFromCode;
    return binding;
  });
  const flag: Flag = {
    id: row.id,
    key: row.key,
    description: row.description,
    type: row.type,
    createdAt: iso(row.createdAt),
    createdBy: row.createdBy,
    environments,
    services,
  };
  if (row.dependsOn !== null) flag.dependsOn = row.dependsOn;
  if (row.owner !== null) flag.owner = row.owner;
  if (row.reviewBy !== null) flag.reviewBy = iso(row.reviewBy);
  if (row.tags.length) flag.tags = row.tags;
  if (row.notify) flag.notify = true;
  return flag;
}

/** Never exposes the credential digests: only whether a credential exists and until when the previous one works. */
export function toService(row: ServiceRow, now = new Date()): Service {
  const previousUntil =
    row.previousTokenHash !== null && row.previousTokenExpiresAt !== null && row.previousTokenExpiresAt > now ? row.previousTokenExpiresAt : null;
  const service: Service = {
    id: row.id,
    key: row.key,
    name: row.name,
    registeredAt: iso(row.registeredAt),
    registeredBy: row.registeredBy,
    hasCredential: row.tokenHash !== null,
    credentialStatus: previousUntil ? "rotating" : "active",
    credentialLastRotated: iso(row.credentialLastRotated),
    checkIns: Object.fromEntries(row.checkIns.map((c) => [c.environment, iso(c.at)])),
  };
  if (previousUntil) service.previousCredentialExpiresAt = iso(previousUntil);
  const latest = row.checkIns.reduce<Date | null>((max, c) => (max && max >= c.at ? max : c.at), null);
  if (latest) service.lastCheckInAt = iso(latest);
  return service;
}

export function toAuditEntry(row: AuditRow): AuditLogEntry {
  const entry: AuditLogEntry = { id: row.id, timestamp: iso(row.timestamp), actor: row.actor, action: row.action as AuditLogEntry["action"] };
  for (const field of ["flagKey", "serviceKey", "environment", "from", "to", "note"] as const) {
    const value = row[field];
    if (value !== null) Object.assign(entry, { [field]: value });
  }
  return entry;
}
