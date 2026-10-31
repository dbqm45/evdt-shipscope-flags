import { describe, expect, it, vi } from "vitest";
import type { Role } from "../types";
import { guardActions } from "./guardActions";
import type { StoreActions } from "./useStore";

function spyActions(): StoreActions {
  const ok = vi.fn(async () => ({ ok: true }));
  return {
    toggleEnvironment: ok,
    updateBinding: ok,
    retireFlag: ok,
    createFlag: ok,
    updateFlagMeta: ok,
    setStaleThreshold: ok,
    registerService: ok,
    rotateCredential: ok,
  };
}

/** Every action called once with valid input; true where it reached the wrapped action. */
async function reached(role: Role) {
  const inner = spyActions();
  const guarded = guardActions(role, inner);
  const results = {
    toggle: await guarded.toggleEnvironment("f", "qa"),
    binding: await guarded.updateBinding("f", "svc", { readMode: "runtime" }),
    retire: await guarded.retireFlag("f"),
    create: await guarded.createFlag({ key: "f", description: "", type: "feature", serviceIds: [] }),
    details: await guarded.updateFlagMeta("f", { owner: "x" }),
    threshold: await guarded.setStaleThreshold(14),
    register: await guarded.registerService("svc", ""),
    rotate: await guarded.rotateCredential("svc", false),
  };
  return Object.fromEntries(Object.entries(results).map(([name, r]) => [name, r.ok]));
}

describe("guardActions", () => {
  it("lets each role do what the API allows it, and nothing more", async () => {
    expect(await reached("viewer")).toEqual({
      toggle: false,
      binding: false,
      retire: false,
      create: false,
      details: false,
      threshold: false,
      register: false,
      rotate: false,
    });
    expect(await reached("editor")).toEqual({
      toggle: true,
      binding: true,
      retire: true,
      create: true,
      details: true,
      threshold: false,
      register: false,
      rotate: false,
    });
    expect(await reached("admin")).toEqual({
      toggle: true,
      binding: true,
      retire: true,
      create: true,
      details: true,
      threshold: true,
      register: true,
      rotate: true,
    });
  });

  it("says why, and catches input the form can check without the server", async () => {
    const inner = spyActions();
    const admin = guardActions("admin", inner);
    expect(await guardActions("viewer", inner).toggleEnvironment("f", "qa")).toEqual({ ok: false, reason: "Viewers cannot change flag state." });
    expect(await admin.createFlag({ key: " ", description: "", type: "feature", serviceIds: [] })).toEqual({ ok: false, reason: "Flag key is required." });
    expect(await admin.setStaleThreshold(400)).toMatchObject({ ok: false, reason: expect.stringMatching(/1 to 365/) });
    expect(await admin.registerService("  ", "")).toEqual({ ok: false, reason: "Service key is required." });
    await admin.registerService(" orders-api ", " Orders ");
    expect(inner.registerService).toHaveBeenCalledWith("orders-api", "Orders");
  });
});
