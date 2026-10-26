import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, ApiUnavailableError } from "../api/client";
import { makeBinding, makeFlag, makeService } from "../test/factories";
import type { AuditLogEntry, Flag } from "../types";
import { StoreProvider } from "./store";
import { useStore } from "./useStore";

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return {
    ...actual,
    api: {
      load: vi.fn(),
      listAuditLog: vi.fn(),
      setEnvironmentState: vi.fn(),
      createFlag: vi.fn(),
      updateFlag: vi.fn(),
      updateBinding: vi.fn(),
      retireFlag: vi.fn(),
      registerService: vi.fn(),
      rotateCredential: vi.fn(),
    },
  };
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
  vi.mocked(api.listAuditLog).mockResolvedValue({ entries: serverAudit });
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

describe("store: flag management with the API", () => {
  it("creates a flag on the server and shows what it stored", async () => {
    const created = makeFlag({ key: "new-search", services: [makeBinding("svc-web")] });
    vi.mocked(api.createFlag).mockResolvedValue(created);
    const { result } = await renderStore();

    let outcome;
    await act(async () => {
      outcome = await result.current.createFlag({ key: "new-search", description: "d", type: "release", serviceIds: ["svc-web"] });
    });

    expect(outcome).toEqual({ ok: true });
    expect(api.createFlag).toHaveBeenCalledWith({ key: "new-search", description: "d", type: "release", serviceIds: ["svc-web"] }, "m.chen");
    expect(result.current.flags[0]).toEqual(created);
    await waitFor(() => expect(result.current.auditLog).toEqual(serverAudit));
  });

  it("shows the server's reason when it refuses to retire a flag, and keeps the flag", async () => {
    vi.mocked(api.retireFlag).mockRejectedValue(new ApiError('"frontend" depends on this flag.', 409));
    const { result } = await renderStore();

    let outcome;
    await act(async () => {
      outcome = await result.current.retireFlag("backend");
    });

    expect(outcome).toEqual({ ok: false, reason: '"frontend" depends on this flag.' });
    expect(result.current.flags.map((f) => f.key)).toContain("backend");
  });

  it("removes a retired flag and replaces an edited one with the server's version", async () => {
    vi.mocked(api.retireFlag).mockResolvedValue({ ok: true });
    const edited = { ...flags[0], owner: "a.kowalska" };
    vi.mocked(api.updateFlag).mockResolvedValue(edited);
    const { result } = await renderStore();

    await act(async () => {
      await result.current.retireFlag("frontend");
      await result.current.updateFlagMeta("backend", { owner: "a.kowalska" });
    });

    expect(result.current.flags).toEqual([edited]);
    expect(api.updateFlag).toHaveBeenCalledWith("backend", { owner: "a.kowalska" }, "m.chen");
  });
});

describe("store: permissions and local changes in demo mode", () => {
  it("lets a viewer change nothing", async () => {
    const { result } = await renderStore();
    act(() => result.current.setRole("viewer"));

    expect(await toggle(result, "backend", "qa")).toMatchObject({ ok: false });
    expect(await result.current.createFlag({ key: "x", description: "", type: "feature", serviceIds: [] })).toMatchObject({ ok: false });
    expect(await result.current.retireFlag("frontend")).toMatchObject({ ok: false });
    expect(await result.current.updateFlagMeta("backend", { owner: "x" })).toMatchObject({ ok: false });
    expect(api.setEnvironmentState).not.toHaveBeenCalled();
    expect(api.createFlag).not.toHaveBeenCalled();
    expect(api.retireFlag).not.toHaveBeenCalled();
  });

  it("creates a flag OFF everywhere, bound to the chosen services, and rejects a duplicate key", async () => {
    loadWith(true);
    const { result } = await renderStore();

    await act(async () => {
      expect(await result.current.createFlag({ key: "new-search", description: "d", type: "release", serviceIds: ["svc-web"] })).toEqual({ ok: true });
    });

    const created = result.current.flags[0];
    expect(created).toMatchObject({ key: "new-search", owner: "m.chen", services: [expect.objectContaining({ serviceId: "svc-web", readMode: "runtime" })] });
    expect(Object.values(created.environments).every((e) => !e.enabled)).toBe(true);
    expect(result.current.auditLog.slice(0, 2).map((e) => e.action)).toEqual(["service-assigned", "flag-created"]);
    expect(await result.current.createFlag({ key: "backend", description: "", type: "release", serviceIds: [] })).toEqual({
      ok: false,
      reason: "A flag with this key already exists.",
    });
    expect(api.createFlag).not.toHaveBeenCalled();
  });

  it("refuses to retire a flag that is not safe to remove", async () => {
    loadWith(true);
    const { result } = await renderStore();

    let outcome;
    await act(async () => {
      outcome = await result.current.retireFlag("backend");
    });

    expect(outcome).toEqual({ ok: false, reason: '"frontend" depends on this flag.' });
    expect(result.current.flags.map((f) => f.key)).toContain("backend");
  });
});

describe("store: services and credentials", () => {
  it("lets an Admin register a service through the API: the service is listed and the credential returned once", async () => {
    const registered = { ...makeService("svc-billing", "billing-api"), lastCheckInAt: undefined };
    vi.mocked(api.registerService).mockResolvedValue({ service: registered, token: "ssf_secret" });
    const { result } = await renderStore();
    act(() => result.current.setRole("admin"));

    let outcome;
    await act(async () => {
      outcome = await result.current.registerService(" billing-api ", "");
    });

    expect(outcome).toEqual({ ok: true, token: "ssf_secret" });
    expect(api.registerService).toHaveBeenCalledWith("billing-api", "", "a.kowalska");
    expect(result.current.services.map((s) => s.key)).toEqual(["orders-api", "shop-web", "billing-api"]);
    await waitFor(() => expect(result.current.auditLog).toEqual(serverAudit));
  });

  it("replaces the rotated service with the server's version", async () => {
    const rotated = { ...makeService("svc-api", "orders-api"), credentialStatus: "rotating" as const, previousCredentialExpiresAt: "2026-10-27T10:00:00.000Z" };
    vi.mocked(api.rotateCredential).mockResolvedValue({ service: rotated, token: "ssf_new" });
    const { result } = await renderStore();
    act(() => result.current.setRole("admin"));

    let outcome;
    await act(async () => {
      outcome = await result.current.rotateCredential("svc-api", false);
    });

    expect(outcome).toEqual({ ok: true, token: "ssf_new" });
    expect(api.rotateCredential).toHaveBeenCalledWith("svc-api", false, "a.kowalska");
    expect(result.current.services[0]).toEqual(rotated);
  });

  it("refuses for anyone but an Admin, and in demo mode, without calling the API", async () => {
    const { result } = await renderStore();
    expect(await result.current.rotateCredential("svc-api", false)).toEqual({
      ok: false,
      reason: "Only Admins can register services and rotate their credentials.",
    });

    loadWith(true);
    const demo = await renderStore();
    act(() => demo.result.current.setRole("admin"));
    expect(await demo.result.current.registerService("billing-api", "")).toMatchObject({ ok: false, reason: expect.stringMatching(/demo data/) });
    expect(api.registerService).not.toHaveBeenCalled();
    expect(api.rotateCredential).not.toHaveBeenCalled();
  });
});
