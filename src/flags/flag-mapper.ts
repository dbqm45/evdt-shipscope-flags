import type { Prisma } from "../generated/prisma/client.js";
import type { AuditLogEntry, Environment, EnvironmentState, Flag, FlagServiceBinding, ReadMode, Service } from "./shared/types.js";

// Converts between database rows and the shapes the API returns (src/flags/shared/types.ts, generated from the
// frontend). Optional fields stay absent instead of null, as the dashboard and the seed data expect.

export const FLAG_INCLUDE = { environments: true, services: { orderBy: { position: "asc" } } } satisfies Prisma.FlagInclude;
type FlagRow = Prisma.FlagGetPayload<{ include: typeof FLAG_INCLUDE }>;
type ServiceRow = Prisma.ServiceGetPayload<object>;
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
      lastCheckInAt: iso(b.lastCheckInAt),
      driftSuspected: b.driftSuspected,
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
  return flag;
}

export function toService(row: ServiceRow): Service {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    registeredAt: iso(row.registeredAt),
    registeredBy: row.registeredBy,
    credentialStatus: row.credentialStatus,
    credentialLastRotated: iso(row.credentialLastRotated),
    lastCheckInAt: iso(row.lastCheckInAt),
  };
}

export function toAuditEntry(row: AuditRow): AuditLogEntry {
  const entry: AuditLogEntry = { id: row.id, timestamp: iso(row.timestamp), actor: row.actor, action: row.action as AuditLogEntry["action"] };
  for (const field of ["flagKey", "serviceKey", "environment", "from", "to", "note"] as const) {
    const value = row[field];
    if (value !== null) Object.assign(entry, { [field]: value });
  }
  return entry;
}
