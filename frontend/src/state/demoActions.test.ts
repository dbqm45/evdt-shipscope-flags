import { describe, expect, it, vi } from "vitest";
import { makeBinding, makeFlag, makeService } from "../test/factories";
import type { AuditLogEntry, Flag } from "../types";
import { demoActions, type DemoContext } from "./demoActions";

/** The actions over plain variables that stand in for React state. */
function demo(flags: Flag[]) {
  const state = { flags, auditLog: [] as AuditLogEntry[], staleThresholdDays: 30 };
  const context: DemoContext = {
    flags,
    services: [makeService("svc-api", "orders-api")],
    staleThresholdDays: 30,
    actor: "m.chen",
    setFlags: (next) => (state.flags = typeof next === "function" ? next(state.flags) : next),
    setAuditLog: (next) => (state.auditLog = typeof next === "function" ? next(state.auditLog) : next),
    setStaleThresholdDays: vi.fn(),
  };
  return { actions: demoActions(context), state };
}

describe("demoActions", () => {
  it("applies the shared rules in the browser and records each change, or the blocked attempt", async () => {
    const { actions, state } = demo([makeFlag({ key: "backend", on: ["test"], services: [makeBinding("svc-api")] })]);

    expect(await actions.toggleEnvironment("backend", "prod")).toMatchObject({ ok: false });
    expect(await actions.toggleEnvironment("backend", "qa")).toEqual({ ok: true });
    expect(state.flags[0].environments.qa).toMatchObject({ enabled: true, updatedBy: "m.chen" });
    expect(state.auditLog.map((e) => [e.action, e.environment, e.actor])).toEqual([
      ["env-enabled", "qa", "m.chen"],
      ["promotion-blocked", "prod", "m.chen"],
    ]);
  });

  it("creates a flag with its service assignments and refuses a duplicate key", async () => {
    const { actions, state } = demo([]);
    expect(await actions.createFlag({ key: "search", description: "d", type: "release", serviceIds: ["svc-api"] })).toEqual({ ok: true });
    expect(state.flags[0]).toMatchObject({ key: "search", owner: "m.chen", createdBy: "m.chen", services: [{ serviceId: "svc-api", readMode: "runtime" }] });
    expect(state.auditLog.map((e) => e.action)).toEqual(["service-assigned", "flag-created"]);
    // The store makes new actions from the new state on the next render.
    expect(await demo(state.flags).actions.createFlag({ key: "search", description: "", type: "feature", serviceIds: [] })).toEqual({
      ok: false,
      reason: "A flag with this key already exists.",
    });
  });

  it("cannot issue credentials, which only the server has", async () => {
    const { actions } = demo([]);
    expect(await actions.registerService("orders-api", "")).toMatchObject({ ok: false, reason: expect.stringMatching(/not running/) });
    expect(await actions.rotateCredential("svc-api", true)).toMatchObject({ ok: false });
  });
});
