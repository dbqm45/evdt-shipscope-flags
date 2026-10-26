import { describe, expect, it } from "vitest";
import type { AuditLogEntry } from "../types";
import { matchesAuditQuery } from "./auditFilter";

const entry: AuditLogEntry = {
  id: "1",
  timestamp: "2026-10-26T10:00:00.000Z",
  actor: "m.chen",
  action: "env-enabled",
  flagKey: "allowEvseNameEdit",
  note: "Rollout",
};

describe("matchesAuditQuery", () => {
  it("applies the same filters as the API", () => {
    expect(matchesAuditQuery(entry, {})).toBe(true);
    expect(matchesAuditQuery(entry, { flagKey: "allowEvseNameEdit", action: "env-enabled", actor: "m.chen" })).toBe(true);
    expect(matchesAuditQuery(entry, { action: "env-disabled" })).toBe(false);
    expect(matchesAuditQuery(entry, { serviceKey: "orders-api" })).toBe(false);
    expect(matchesAuditQuery(entry, { q: "EVSE" })).toBe(true);
    expect(matchesAuditQuery(entry, { q: "rollout" })).toBe(true);
    expect(matchesAuditQuery(entry, { q: "checkout" })).toBe(false);
  });
});
