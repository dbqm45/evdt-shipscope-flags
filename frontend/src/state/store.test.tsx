import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { makeBinding, makeFlag, makeService } from "../test/factories";
import type { Flag } from "../types";
import { StoreProvider, useStore } from "./store";

vi.mock("../api/client", () => ({
  api: {
    listFlags: vi.fn(),
    listServices: vi.fn(),
    listAuditLog: vi.fn(),
    setEnvironmentState: vi.fn(),
  },
}));

const wrapper = ({ children }: { children: ReactNode }) => <StoreProvider>{children}</StoreProvider>;

let flags: Flag[];

beforeEach(() => {
  flags = [
    makeFlag({ key: "backend", on: ["test"], services: [makeBinding("svc-api")] }),
    makeFlag({ key: "frontend", dependsOn: "backend", services: [makeBinding("svc-web")] }),
  ];
  vi.mocked(api.listFlags).mockResolvedValue(flags);
  vi.mocked(api.listServices).mockResolvedValue([makeService("svc-api", "orders-api"), makeService("svc-web", "shop-web")]);
  vi.mocked(api.listAuditLog).mockResolvedValue([]);
  vi.mocked(api.setEnvironmentState).mockResolvedValue({ ok: true });
});

async function renderStore() {
  const hook = renderHook(() => useStore(), { wrapper });
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

describe("store", () => {
  it("loads flags, services and the audit log from the API", async () => {
    const { result } = await renderStore();
    expect(result.current.flags.map((f) => f.key)).toEqual(["backend", "frontend"]);
    expect(result.current.services).toHaveLength(2);
  });

  it("toggles an environment, records it in the audit log and sends it to the API", async () => {
    const { result } = await renderStore();

    let outcome;
    act(() => {
      outcome = result.current.toggleEnvironment("backend", "qa");
    });

    expect(outcome).toEqual({ ok: true });
    const backend = result.current.flags.find((f) => f.key === "backend")!;
    expect(backend.environments.qa).toMatchObject({ enabled: true, updatedBy: "m.chen" });
    expect(result.current.auditLog[0]).toMatchObject({ action: "env-enabled", flagKey: "backend", environment: "qa", from: "off", to: "on" });
    expect(api.setEnvironmentState).toHaveBeenCalledWith("backend", "qa", true, "m.chen");
  });

  it("blocks an out-of-order toggle, logs the attempt and does not call the API", async () => {
    const { result } = await renderStore();

    let outcome: { ok: boolean; reason?: string } | undefined;
    act(() => {
      outcome = result.current.toggleEnvironment("backend", "prod");
    });

    expect(outcome?.ok).toBe(false);
    expect(outcome?.reason).toMatch(/Enable in qa first/);
    expect(result.current.flags.find((f) => f.key === "backend")!.environments.prod.enabled).toBe(false);
    expect(result.current.auditLog[0]).toMatchObject({ action: "promotion-blocked", flagKey: "backend", environment: "prod" });
    expect(api.setEnvironmentState).not.toHaveBeenCalled();
  });

  it("lets a viewer change nothing", async () => {
    const { result } = await renderStore();
    act(() => result.current.setRole("viewer"));

    expect(result.current.toggleEnvironment("backend", "qa")).toMatchObject({ ok: false });
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
