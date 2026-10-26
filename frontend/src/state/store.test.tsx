import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, ApiUnavailableError } from "../api/client";
import { makeBinding, makeFlag, makeService } from "../test/factories";
import type { AuditLogEntry, Flag } from "../types";
import { StoreProvider, useStore } from "./store";

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, api: { load: vi.fn(), listAuditLog: vi.fn(), setEnvironmentState: vi.fn() } };
});

const wrapper = ({ children }: { children: ReactNode }) => <StoreProvider>{children}</StoreProvider>;

let flags: Flag[];
const serverAudit: AuditLogEntry[] = [{ id: "srv-1", timestamp: "2026-10-26T10:00:00.000Z", actor: "m.chen", action: "env-enabled", flagKey: "backend" }];

function loadWith(demo: boolean) {
  vi.mocked(api.load).mockResolvedValue({
    flags,
    services: [makeService("svc-api", "orders-api"), makeService("svc-web", "shop-web")],
    auditLog: [],
    demo,
  });
}

beforeEach(() => {
  flags = [
    makeFlag({ key: "backend", on: ["test"], services: [makeBinding("svc-api")] }),
    makeFlag({ key: "frontend", dependsOn: "backend", services: [makeBinding("svc-web")] }),
  ];
  loadWith(false);
  vi.mocked(api.listAuditLog).mockResolvedValue(serverAudit);
});

async function renderStore() {
  const hook = renderHook(() => useStore(), { wrapper });
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

async function toggle(result: { current: ReturnType<typeof useStore> }, flagKey: string, env: "test" | "qa" | "prod") {
  let outcome: { ok: boolean; reason?: string } | undefined;
  await act(async () => {
    outcome = await result.current.toggleEnvironment(flagKey, env);
  });
  return outcome!;
}

describe("store with the API", () => {
  it("loads flags, services and the audit log, not in demo mode", async () => {
    const { result } = await renderStore();
    expect(result.current.flags.map((f) => f.key)).toEqual(["backend", "frontend"]);
    expect(result.current.services).toHaveLength(2);
    expect(result.current.demo).toBe(false);
  });

  it("shows the API's error when the initial load fails, instead of demo data", async () => {
    vi.mocked(api.load).mockRejectedValue(new ApiError("Internal server error", 500));
    const { result } = await renderStore();
    expect(result.current.loadError).toBe("Internal server error");
    expect(result.current.flags).toEqual([]);
  });

  it("toggles through the API, shows the flag the server stored and its audit log", async () => {
    const stored = {
      ...flags[0],
      environments: { ...flags[0].environments, qa: { enabled: true, updatedAt: "2026-10-26T10:00:00.000Z", updatedBy: "m.chen" } },
    };
    vi.mocked(api.setEnvironmentState).mockResolvedValue({ ok: true, flag: stored });
    const { result } = await renderStore();

    expect(await toggle(result, "backend", "qa")).toEqual({ ok: true });

    expect(api.setEnvironmentState).toHaveBeenCalledWith("backend", "qa", true, "m.chen");
    expect(result.current.flags.find((f) => f.key === "backend")).toEqual(stored);
    await waitFor(() => expect(result.current.auditLog).toEqual(serverAudit));
  });

  it("shows the server's reason and keeps the state when the API refuses the change", async () => {
    vi.mocked(api.setEnvironmentState).mockRejectedValue(new ApiError("Enable in qa first — flags promote test → qa → prod in order.", 409));
    const { result } = await renderStore();

    expect(await toggle(result, "backend", "prod")).toEqual({ ok: false, reason: "Enable in qa first — flags promote test → qa → prod in order." });

    expect(result.current.flags.find((f) => f.key === "backend")!.environments.prod.enabled).toBe(false);
    // The server logged the blocked attempt; the store shows its log.
    await waitFor(() => expect(api.listAuditLog).toHaveBeenCalled());
  });

  it("changes nothing when the API cannot be reached during a change", async () => {
    vi.mocked(api.setEnvironmentState).mockRejectedValue(new ApiUnavailableError("Failed to fetch"));
    const { result } = await renderStore();

    const outcome = await toggle(result, "backend", "qa");

    expect(outcome).toEqual({ ok: false, reason: "The API is not reachable — nothing was changed." });
    expect(result.current.flags.find((f) => f.key === "backend")!.environments.qa.enabled).toBe(false);
  });
});

describe("store in demo mode", () => {
  beforeEach(() => loadWith(true));

  it("toggles locally and records the change in the local audit log, without calling the API", async () => {
    const { result } = await renderStore();
    expect(result.current.demo).toBe(true);

    expect(await toggle(result, "backend", "qa")).toEqual({ ok: true });

    expect(result.current.flags.find((f) => f.key === "backend")!.environments.qa).toMatchObject({ enabled: true, updatedBy: "m.chen" });
    expect(result.current.auditLog[0]).toMatchObject({ action: "env-enabled", flagKey: "backend", environment: "qa", from: "off", to: "on" });
    expect(api.setEnvironmentState).not.toHaveBeenCalled();
  });

  it("blocks an out-of-order toggle with the local rules and logs the attempt", async () => {
    const { result } = await renderStore();

    const outcome = await toggle(result, "backend", "prod");

    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toMatch(/Enable in qa first/);
    expect(result.current.auditLog[0]).toMatchObject({ action: "promotion-blocked", flagKey: "backend", environment: "prod" });
  });
});

describe("store permissions and local actions", () => {
  it("lets a viewer change nothing", async () => {
    const { result } = await renderStore();
    act(() => result.current.setRole("viewer"));

    expect(await toggle(result, "backend", "qa")).toMatchObject({ ok: false });
    expect(result.current.createFlag({ key: "x", description: "", type: "feature", serviceIds: [] })).toMatchObject({ ok: false });
    expect(result.current.retireFlag("frontend")).toMatchObject({ ok: false });
    expect(api.setEnvironmentState).not.toHaveBeenCalled();
  });

  it("creates a flag OFF everywhere, bound to the chosen services, and rejects a duplicate key", async () => {
    const { result } = await renderStore();

    act(() => {
      expect(result.current.createFlag({ key: "new-search", description: "d", type: "release", serviceIds: ["svc-web"] })).toEqual({ ok: true });
    });

    const created = result.current.flags[0];
    expect(created).toMatchObject({ key: "new-search", owner: "m.chen", services: [expect.objectContaining({ serviceId: "svc-web", readMode: "runtime" })] });
    expect(Object.values(created.environments).every((e) => !e.enabled)).toBe(true);
    expect(result.current.auditLog.slice(0, 2).map((e) => e.action)).toEqual(["service-assigned", "flag-created"]);

    expect(result.current.createFlag({ key: "backend", description: "", type: "release", serviceIds: [] })).toEqual({
      ok: false,
      reason: "A flag with this key already exists.",
    });
  });

  it("refuses to retire a flag that is not safe to remove", async () => {
    const { result } = await renderStore();

    let outcome: { ok: boolean; reason?: string } | undefined;
    act(() => {
      outcome = result.current.retireFlag("backend");
    });

    expect(outcome).toEqual({ ok: false, reason: '"frontend" depends on this flag.' });
    expect(result.current.flags.map((f) => f.key)).toContain("backend");
  });
});
