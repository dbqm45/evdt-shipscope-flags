import type { AuditLogEntry, AuditLogQuery } from "../types";

/** The filters of GET /api/audit-log applied to entries held in the browser (demo mode). */
export function matchesAuditQuery(entry: AuditLogEntry, query: AuditLogQuery): boolean {
  if (query.flagKey && entry.flagKey !== query.flagKey) return false;
  if (query.serviceKey && entry.serviceKey !== query.serviceKey) return false;
  if (query.action && entry.action !== query.action) return false;
  if (query.actor && entry.actor !== query.actor) return false;
  const q = query.q?.trim().toLowerCase();
  return !q || [entry.actor, entry.flagKey, entry.serviceKey, entry.note].some((v) => v?.toLowerCase().includes(q));
}
