import { ConflictException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { resetDatabase, testPrisma } from "../../test/db.js";
import { loadState, seedState, type State } from "../db/load-state.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { PrismaModule } from "../prisma/prisma.service.js";
import { FlagsService } from "./flags.service.js";
import type { Environment, Flag, Service } from "./shared/types.js";

const T0 = "2026-10-01T08:00:00.000Z";
const state = (enabled: boolean) => ({ enabled, updatedAt: T0, updatedBy: "seed" });

function flag(key: string, on: Environment[], extra: Partial<Flag> = {}): Flag {
  return {
    id: `flag-${key}`,
    key,
    description: `${key} flag`,
    type: "release",
    createdAt: T0,
    createdBy: "seed",
    environments: { test: state(on.includes("test")), qa: state(on.includes("qa")), prod: state(on.includes("prod")) },
    services: [],
    ...extra,
  };
}

function service(id: string, key: string): Service {
  return { id, key, name: key, registeredAt: T0, registeredBy: "seed", credentialStatus: "active", credentialLastRotated: T0, lastCheckInAt: T0 };
}

const binding = (serviceId: string) => ({ serviceId, readMode: "runtime" as const, lastCheckInAt: T0, driftSuspected: false });

/** backend ON in test, frontend (depends on backend) OFF everywhere; frontend is read by the web service only. */
const pair = (): State => ({
  services: [service("svc-api", "orders-api"), service("svc-web", "shop-web")],
  flags: [flag("frontend", [], { dependsOn: "backend", services: [binding("svc-web")] }), flag("backend", ["test"], { services: [binding("svc-api")] })],
  auditLog: [],
});

describe("FlagsService (PostgreSQL)", () => {
  let prisma: PrismaClient;
  let flags: FlagsService;

  beforeAll(async () => {
    prisma = testPrisma();
    const moduleRef = await Test.createTestingModule({ imports: [PrismaModule], providers: [FlagsService] }).compile();
    await moduleRef.init();
    flags = moduleRef.get(FlagsService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const json = (value: unknown) => JSON.parse(JSON.stringify(value));

  it("returns the seed data exactly as it was loaded (same shape, order and values as the old JSON state)", async () => {
    const seed = seedState();
    expect(await loadState(prisma, seed)).toBe(true);

    expect(await flags.listFlags()).toEqual(json(seed.flags));
    expect(await flags.listServices()).toEqual(json(seed.services));
    expect(await flags.listAuditLog()).toEqual(json(seed.auditLog));
  });

  it("does not load data into a database that already holds some", async () => {
    await loadState(prisma, pair());
    expect(await loadState(prisma, seedState())).toBe(false);
    expect(await flags.listFlags()).toHaveLength(2);
  });

  it("enables a flag, persists it and records the change, newest first", async () => {
    await loadState(prisma, pair());

    const updated = await flags.setEnvironment("backend", "qa", true, "m.chen");

    expect(updated.environments.qa).toMatchObject({ enabled: true, updatedBy: "m.chen" });
    const stored = (await flags.listFlags()).find((f) => f.key === "backend")!;
    expect(stored.environments.qa).toEqual(updated.environments.qa);
    const [latest] = await flags.listAuditLog();
    expect(latest).toMatchObject({ actor: "m.chen", action: "env-enabled", flagKey: "backend", environment: "qa", from: "off", to: "on" });
  });

  it("rejects an out-of-order change with 409, leaves the state alone and still logs the attempt", async () => {
    await loadState(prisma, pair());

    await expect(flags.setEnvironment("backend", "prod", true, "m.chen")).rejects.toBeInstanceOf(ConflictException);

    expect((await flags.listFlags()).find((f) => f.key === "backend")!.environments.prod.enabled).toBe(false);
    expect(await flags.listAuditLog()).toEqual([expect.objectContaining({ action: "promotion-blocked", flagKey: "backend", environment: "prod" })]);
  });

  it("blocks disabling a flag while a dependent flag is ON", async () => {
    await loadState(prisma, pair());
    await flags.setEnvironment("frontend", "test", true, "m.chen");

    await expect(flags.setEnvironment("backend", "test", false, "m.chen")).rejects.toThrow(/Disable "frontend" in test first/);
  });

  it("serializes concurrent changes, so two individually valid toggles cannot break a dependency together", async () => {
    await loadState(prisma, pair());

    // Alone, each is allowed: frontend may go ON (backend is ON), backend may go OFF (frontend is OFF).
    const results = await Promise.allSettled([flags.setEnvironment("frontend", "test", true, "a"), flags.setEnvironment("backend", "test", false, "b")]);

    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    const byKey = Object.fromEntries((await flags.listFlags()).map((f) => [f.key, f.environments.test.enabled]));
    expect(byKey.frontend && !byKey.backend).toBe(false);
  });

  it("does nothing when the state is already as requested, and 404s an unknown flag", async () => {
    await loadState(prisma, pair());

    await flags.setEnvironment("backend", "test", true, "m.chen");
    await expect(flags.setEnvironment("nope", "test", true, "m.chen")).rejects.toBeInstanceOf(NotFoundException);

    expect(await flags.listAuditLog()).toEqual([]);
  });

  it("evaluates one environment, optionally only for the flags bound to a service", async () => {
    await loadState(prisma, pair());

    expect(await flags.evaluate("test")).toEqual({ frontend: false, backend: true });
    expect(await flags.evaluate("test", "orders-api")).toEqual({ backend: true });
    await expect(flags.evaluate("test", "nope")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("stores notification settings and posts to the webhook on a prod change", async () => {
    await loadState(prisma, pair());
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    try {
      await expect(flags.setNotifications({ enabled: true, webhookUrl: "not-a-url" })).rejects.toThrow(/valid http/);
      expect(await flags.setNotifications({ enabled: true, webhookUrl: "https://hooks.example.test/x" })).toEqual({
        enabled: true,
        webhookUrl: "https://hooks.example.test/x",
      });
      expect(await flags.getNotifications()).toEqual({ enabled: true, webhookUrl: "https://hooks.example.test/x" });

      await flags.setEnvironment("backend", "qa", true, "m.chen");
      await flags.setEnvironment("backend", "prod", true, "m.chen");

      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
      expect(fetch).toHaveBeenCalledWith("https://hooks.example.test/x", expect.objectContaining({ method: "POST" }));
      expect(JSON.parse(fetch.mock.calls[0][1].body).text).toContain("*backend* was turned *ON* in *PROD* by m.chen");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
