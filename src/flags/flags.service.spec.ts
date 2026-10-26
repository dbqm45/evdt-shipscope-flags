import { ConflictException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { resetDatabase, testPrisma } from "../../test/db.js";
import { loadState, seedState, type State } from "../db/load-state.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { PrismaModule } from "../prisma/prisma.service.js";
import { parseAuditQuery } from "./flags.input.js";
import { FlagsService } from "./flags.service.js";
import { hashToken } from "./sdk-auth.js";
import type { Environment, Flag, Service } from "./shared/types.js";

const T0 = "2026-10-01T08:00:00.000Z";
/** The cursor the API hands out, as the controller parses it back. */
const decode = (cursor: string) => parseAuditQuery({ before: cursor }).before!;
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
  return {
    id,
    key,
    name: key,
    registeredAt: T0,
    registeredBy: "seed",
    hasCredential: false,
    credentialStatus: "active",
    credentialLastRotated: T0,
    lastCheckInAt: T0,
    checkIns: { test: T0 },
  };
}

const binding = (serviceId: string) => ({ serviceId, readMode: "runtime" as const });

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
  const auditEntries = async () => (await flags.listAuditLog({ limit: 200 })).entries;

  it("returns the seed data exactly as it was loaded (same shape, order and values as the old JSON state)", async () => {
    const seed = seedState();
    expect(await loadState(prisma, seed)).toBe(true);

    expect(await flags.listFlags()).toEqual(json(seed.flags));
    // Credentials are never loaded: every service starts without one.
    const withoutCredentials = seed.services.map((s) => ({ ...s, hasCredential: false, credentialStatus: "active", previousCredentialExpiresAt: undefined }));
    expect(await flags.listServices()).toEqual(json(withoutCredentials));
    expect(await auditEntries()).toEqual(json(seed.auditLog));
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
    const [latest] = await auditEntries();
    expect(latest).toMatchObject({ actor: "m.chen", action: "env-enabled", flagKey: "backend", environment: "qa", from: "off", to: "on" });
  });

  it("rejects an out-of-order change with 409, leaves the state alone and still logs the attempt", async () => {
    await loadState(prisma, pair());

    await expect(flags.setEnvironment("backend", "prod", true, "m.chen")).rejects.toBeInstanceOf(ConflictException);

    expect((await flags.listFlags()).find((f) => f.key === "backend")!.environments.prod.enabled).toBe(false);
    expect(await auditEntries()).toEqual([expect.objectContaining({ action: "promotion-blocked", flagKey: "backend", environment: "prod" })]);
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

    expect(await auditEntries()).toEqual([]);
  });

  it("evaluates one environment, optionally only for the flags bound to a service", async () => {
    await loadState(prisma, pair());

    expect(await flags.evaluate("test")).toEqual({ frontend: false, backend: true });
    expect(await flags.evaluate("test", "orders-api")).toEqual({ backend: true });
    await expect(flags.evaluate("test", "nope")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("stores notification settings, shows the webhook masked and posts to it on a prod change", async () => {
    await loadState(prisma, pair());
    flags.webhookLookup = async () => [{ address: "203.0.113.10", family: 4 }]; // a public address
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    try {
      await expect(flags.setNotifications({ enabled: true, webhookUrl: "not-a-url" })).rejects.toThrow(/not a valid URL/);
      expect(await flags.setNotifications({ enabled: true, webhookUrl: "https://hooks.example.test/services/T0/B0/secret1234" })).toEqual({
        enabled: true,
        webhookUrl: "https://hooks.example.test/…/1234",
      });
      expect(await flags.getNotifications()).toEqual({ enabled: true, webhookUrl: "https://hooks.example.test/…/1234" });

      // The form sends the masked value back with another field: the stored URL stays.
      await flags.setNotifications({ enabled: true, webhookUrl: "https://hooks.example.test/…/1234" });
      await flags.setEnvironment("backend", "qa", true, "m.chen");
      await flags.setEnvironment("backend", "prod", true, "m.chen");

      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
      expect(String(fetch.mock.calls[0][0])).toBe("https://hooks.example.test/services/T0/B0/secret1234");
      expect(fetch.mock.calls[0][1]).toMatchObject({ method: "POST", redirect: "manual" });
      expect(JSON.parse(fetch.mock.calls[0][1].body).text).toContain("*backend* was turned *ON* in *PROD* by m.chen");
    } finally {
      vi.unstubAllGlobals();
      flags.webhookLookup = undefined;
    }
  });

  it("keeps the stale threshold at 30 days until an Admin changes it, and logs each change", async () => {
    expect(await flags.getRuleSettings()).toEqual({ staleThresholdDays: 30 });

    expect(await flags.setRuleSettings({ staleThresholdDays: 14 }, "a.kowalska")).toEqual({ staleThresholdDays: 14 });
    expect(await flags.getRuleSettings()).toEqual({ staleThresholdDays: 14 });
    expect((await auditEntries())[0]).toMatchObject({ action: "settings-updated", actor: "a.kowalska", note: "stale threshold 30 → 14 days" });

    await flags.setRuleSettings({ staleThresholdDays: 14 }, "a.kowalska");
    expect((await auditEntries()).filter((e) => e.action === "settings-updated")).toHaveLength(1);
  });

  describe("per-flag notifications and retries", () => {
    const WEBHOOK = "https://hooks.example.test/services/T0/B0/secret1234";
    const promote = async (flagKey: string) => {
      await flags.setEnvironment(flagKey, "qa", true, "m.chen");
      await flags.setEnvironment(flagKey, "prod", true, "m.chen");
    };

    beforeEach(async () => {
      await loadState(prisma, pair());
      flags.webhookLookup = async () => [{ address: "203.0.113.10", family: 4 }];
      flags.notificationRetryDelaysMs = [1, 1];
      await flags.setNotifications({ enabled: false, webhookUrl: WEBHOOK });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      flags.webhookLookup = undefined;
      flags.notificationRetryDelaysMs = [2_000, 10_000];
    });

    it("notifies about a flag that asks for it while notifications for all flags are off", async () => {
      const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
      vi.stubGlobal("fetch", fetch);
      await flags.setEnvironment("backend", "qa", true, "m.chen");
      await flags.setEnvironment("backend", "prod", true, "m.chen");
      await flags.setEnvironment("backend", "prod", false, "m.chen");
      expect(fetch).not.toHaveBeenCalled();

      expect(await flags.updateFlag("backend", { notify: true }, "a.kowalska")).toMatchObject({ notify: true });
      await flags.setEnvironment("backend", "prod", true, "m.chen");

      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
      expect(JSON.parse(fetch.mock.calls[0][1].body).text).toContain("*backend* was turned *ON* in *PROD*");
    });

    it("retries a failed send and logs the failure once every attempt failed", async () => {
      await flags.updateFlag("backend", { notify: true }, "a.kowalska");
      const fetch = vi
        .fn()
        .mockRejectedValueOnce(new TypeError("fetch failed"))
        .mockResolvedValueOnce(new Response(null, { status: 503 }))
        .mockResolvedValueOnce(new Response(null, { status: 200 }));
      vi.stubGlobal("fetch", fetch);

      await promote("backend");
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
      expect((await auditEntries()).some((e) => e.action === "notification-failed")).toBe(false);

      fetch.mockReset().mockResolvedValue(new Response(null, { status: 502 }));
      await flags.setEnvironment("backend", "prod", false, "m.chen");
      await vi.waitFor(async () => expect((await auditEntries())[0]).toMatchObject({ action: "notification-failed", flagKey: "backend", note: "HTTP 502" }));
      expect(fetch).toHaveBeenCalledTimes(3);
    });

    it("does not retry an answer that will not change, such as 404", async () => {
      await flags.updateFlag("backend", { notify: true }, "a.kowalska");
      const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
      vi.stubGlobal("fetch", fetch);

      await promote("backend");

      await vi.waitFor(async () => expect((await auditEntries())[0]).toMatchObject({ action: "notification-failed", note: "HTTP 404" }));
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });

  it("refuses a webhook that points into the network, at save and again at send", async () => {
    await loadState(prisma, pair());
    let address = "10.0.0.5";
    flags.webhookLookup = async () => [{ address, family: 4 }];
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    try {
      await expect(flags.setNotifications({ enabled: true, webhookUrl: "https://chat.example.test/hook" })).rejects.toThrow(/private or local address/);
      await expect(flags.setNotifications({ enabled: true, webhookUrl: "http://hooks.example.test/hook" })).rejects.toThrow(/must use https/);

      address = "203.0.113.10";
      await flags.setNotifications({ enabled: true, webhookUrl: "https://chat.example.test/hook" });
      address = "127.0.0.1"; // DNS changed after the URL was saved
      expect(await flags.testNotification()).toEqual({ ok: false, error: 'The webhook host "chat.example.test" points to a private or local address.' });
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      flags.webhookLookup = undefined;
    }
  });

  describe("managing flags", () => {
    it("creates a flag OFF everywhere, bound to its services, and records it", async () => {
      await loadState(prisma, pair());

      const created = await flags.createFlag(
        { key: "new-search", description: "Search v2", type: "release", serviceIds: ["svc-web", "svc-api"], dependsOn: "backend", tags: ["search"] },
        "m.chen",
      );

      expect(created).toMatchObject({
        key: "new-search",
        description: "Search v2",
        type: "release",
        dependsOn: "backend",
        owner: "m.chen",
        createdBy: "m.chen",
        tags: ["search"],
        services: [expect.objectContaining({ serviceId: "svc-web", readMode: "runtime" }), expect.objectContaining({ serviceId: "svc-api" })],
      });
      expect(Object.values(created.environments).map((e) => e.enabled)).toEqual([false, false, false]);
      expect((await flags.listFlags())[0].key).toBe("new-search");
      expect((await auditEntries()).map((e) => [e.action, e.serviceKey])).toEqual([
        ["service-assigned", "orders-api"],
        ["service-assigned", "shop-web"],
        ["flag-created", undefined],
      ]);
    });

    it("refuses a duplicate key (409), an unknown service or dependency (400), and writes nothing", async () => {
      await loadState(prisma, pair());
      const base = { description: "", type: "feature" as const, serviceIds: [], tags: [] };

      await expect(flags.createFlag({ ...base, key: "backend" }, "m.chen")).rejects.toBeInstanceOf(ConflictException);
      await expect(flags.createFlag({ ...base, key: "x", serviceIds: ["svc-nope"] }, "m.chen")).rejects.toThrow(/Unknown service id: svc-nope/);
      await expect(flags.createFlag({ ...base, key: "y", dependsOn: "nope" }, "m.chen")).rejects.toThrow(/does not exist: "nope"/);

      expect(await flags.listFlags()).toHaveLength(2);
      expect(await auditEntries()).toEqual([]);
    });

    it("updates the details and clears what is sent empty", async () => {
      await loadState(prisma, pair());
      await flags.updateFlag("backend", { owner: "a.kowalska", reviewBy: "2026-12-01", tags: ["orders"] }, "m.chen");

      const updated = await flags.updateFlag("backend", { owner: null, reviewBy: null, description: "Orders API flag" }, "m.chen");

      expect(updated).toMatchObject({ description: "Orders API flag", tags: ["orders"] });
      expect(updated.owner).toBeUndefined();
      expect(updated.reviewBy).toBeUndefined();
      expect((await auditEntries())[0]).toMatchObject({ action: "flag-updated", flagKey: "backend", note: "updated owner, reviewBy, description" });
      await expect(flags.updateFlag("nope", { owner: "x" }, "m.chen")).rejects.toBeInstanceOf(NotFoundException);
    });

    it("changes how a service reads the flag", async () => {
      await loadState(prisma, pair());

      const updated = await flags.updateBinding("backend", "svc-api", { readMode: "both", buildTimeValues: { test: true, qa: false, prod: false } }, "m.chen");

      expect(updated.services[0]).toMatchObject({ serviceId: "svc-api", readMode: "both", buildTimeValues: { test: true, qa: false, prod: false } });
      expect((await auditEntries())[0]).toMatchObject({ action: "binding-updated", serviceKey: "orders-api", note: "updated readMode, buildTimeValues" });
      await expect(flags.updateBinding("backend", "svc-web", { removedFromCode: true }, "m.chen")).rejects.toThrow(/not assigned to service "svc-web"/);
    });

    it("refuses to retire a flag while removing it could change a service, with every reason", async () => {
      await loadState(prisma, pair());

      await expect(flags.retireFlag("backend", "m.chen")).rejects.toThrow(
        '"frontend" depends on this flag. orders-api still reads this flag at runtime — remove it from the code first, otherwise it loses the value.',
      );
      expect(await flags.listFlags()).toHaveLength(2);
    });

    it("retires a flag once it is safe, and services no longer see it", async () => {
      await loadState(prisma, pair());
      await flags.updateBinding("frontend", "svc-web", { removedFromCode: true }, "m.chen");

      await flags.retireFlag("frontend", "m.chen");

      expect((await flags.listFlags()).map((f) => f.key)).toEqual(["backend"]);
      expect(await flags.evaluate("test", "shop-web")).toEqual({});
      expect((await auditEntries())[0]).toMatchObject({ action: "flag-retired", flagKey: "frontend" });
      await expect(flags.retireFlag("frontend", "m.chen")).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("services and their credentials", () => {
    const serviceByToken = (token: string) => flags.serviceByToken(hashToken(token));

    it("registers a service with a credential that is returned once and stored only as a digest", async () => {
      const { service, token } = await flags.registerService({ key: "billing-api", name: "Billing API" }, "a.kowalska");

      expect(service).toMatchObject({
        id: "svc-billing-api",
        key: "billing-api",
        name: "Billing API",
        registeredBy: "a.kowalska",
        hasCredential: true,
        credentialStatus: "active",
      });
      expect(service).not.toHaveProperty("lastCheckInAt");
      expect(await serviceByToken(token)).toEqual({ id: "svc-billing-api", key: "billing-api" });
      const row = await prisma.service.findUniqueOrThrow({ where: { id: "svc-billing-api" } });
      expect(JSON.stringify(row)).not.toContain(token);
      expect(JSON.stringify(await flags.listServices())).not.toContain(row.tokenHash!);
      expect((await auditEntries())[0]).toMatchObject({ action: "service-registered", serviceKey: "billing-api", actor: "a.kowalska" });
      await expect(flags.registerService({ key: "billing-api", name: "again" }, "a.kowalska")).rejects.toBeInstanceOf(ConflictException);
    });

    it("rotates a credential: the old one keeps working for 24 hours, then stops", async () => {
      const { token: first } = await flags.registerService({ key: "billing-api", name: "billing-api" }, "a.kowalska");

      const { service, token: second } = await flags.rotateCredential("svc-billing-api", false, "a.kowalska");

      expect(service.credentialStatus).toBe("rotating");
      const until = Date.parse(service.previousCredentialExpiresAt!);
      expect(until - Date.now()).toBeGreaterThan(23.9 * 3600_000);
      expect(await serviceByToken(first)).not.toBeNull();
      expect(await serviceByToken(second)).not.toBeNull();
      expect((await auditEntries())[0]).toMatchObject({
        action: "credential-rotated",
        serviceKey: "billing-api",
        note: expect.stringMatching(/^previous credential works until/),
      });

      await prisma.service.update({ where: { id: "svc-billing-api" }, data: { previousTokenExpiresAt: new Date(Date.now() - 1000) } });
      expect(await serviceByToken(first)).toBeNull();
      expect(await serviceByToken(second)).not.toBeNull();
      expect((await flags.listServices())[0]).toMatchObject({ credentialStatus: "active" });
    });

    it("revokes the old credential at once when asked, and issues a first one to a service that had none", async () => {
      const { token: first } = await flags.registerService({ key: "billing-api", name: "billing-api" }, "a.kowalska");
      const { service, token } = await flags.rotateCredential("svc-billing-api", true, "a.kowalska");
      expect(service.credentialStatus).toBe("active");
      expect(await serviceByToken(first)).toBeNull();
      expect(await serviceByToken(token)).not.toBeNull();
      expect((await auditEntries())[0]).toMatchObject({ note: "previous credential revoked" });

      await prisma.service.create({ data: { id: "svc-old", key: "old", name: "old", registeredAt: T0, registeredBy: "seed", credentialLastRotated: T0 } });
      expect((await flags.listServices()).find((s) => s.key === "old")).toMatchObject({ hasCredential: false });
      const issued = await flags.rotateCredential("svc-old", false, "a.kowalska");
      expect(issued.service).toMatchObject({ hasCredential: true, credentialStatus: "active" });
      expect((await auditEntries())[0]).toMatchObject({ serviceKey: "old", note: "first credential issued" });
      await expect(flags.rotateCredential("svc-nope", false, "a.kowalska")).rejects.toBeInstanceOf(NotFoundException);
    });

    it("records a check-in per environment, at most every 30 seconds", async () => {
      await loadState(prisma, pair());
      const before = Date.now();

      await flags.recordCheckIn("svc-api", "prod");

      const [api, web] = await flags.listServices();
      expect(api.checkIns.test).toBe(T0);
      expect(Date.parse(api.checkIns.prod!)).toBeGreaterThanOrEqual(before);
      expect(api.lastCheckInAt).toBe(api.checkIns.prod);
      expect(web.checkIns).toEqual({ test: T0 });

      await flags.recordCheckIn("svc-api", "prod");
      expect((await flags.listServices())[0].checkIns.prod).toBe(api.checkIns.prod);

      // Older than the interval: moved forward.
      await prisma.serviceCheckIn.update({
        where: { serviceId_environment: { serviceId: "svc-api", environment: "prod" } },
        data: { at: new Date(before - 60_000) },
      });
      await flags.recordCheckIn("svc-api", "prod");
      expect(Date.parse((await flags.listServices())[0].checkIns.prod!)).toBeGreaterThanOrEqual(before);
    });
  });

  describe("the audit log", () => {
    it("pages newest first with a cursor that stays stable while new entries arrive", async () => {
      await loadState(prisma, seedState());
      const all = await auditEntries();

      const first = await flags.listAuditLog({ limit: 5 });
      expect(first.entries).toEqual(all.slice(0, 5));
      await flags.setEnvironment("b2cCustomersEnabled", "test", false, "m.chen"); // a new entry on top
      const second = await flags.listAuditLog({ limit: 5, before: decode(first.nextCursor!) });
      expect(second.entries).toEqual(all.slice(5, 10));

      const rest = await flags.listAuditLog({ limit: 200, before: decode(second.nextCursor!) });
      expect(rest.entries).toEqual(all.slice(10));
      expect(rest).not.toHaveProperty("nextCursor");
    });

    it("filters by flag, service, action, actor and free text", async () => {
      await loadState(prisma, seedState());
      const all = await auditEntries();
      const keys = (page: { entries: { id: string }[] }) => page.entries.map((e) => e.id);
      const ids = (pick: (e: (typeof all)[number]) => boolean) => all.filter(pick).map((e) => e.id);

      expect(keys(await flags.listAuditLog({ limit: 200, flagKey: "b2cCustomersEnabled" }))).toEqual(ids((e) => e.flagKey === "b2cCustomersEnabled"));
      expect(keys(await flags.listAuditLog({ limit: 200, serviceKey: "evam-service-host" }))).toEqual(ids((e) => e.serviceKey === "evam-service-host"));
      expect(keys(await flags.listAuditLog({ limit: 200, action: "promotion-blocked" }))).toEqual(ids((e) => e.action === "promotion-blocked"));
      expect(keys(await flags.listAuditLog({ limit: 200, actor: "j.novak" }))).toEqual(ids((e) => e.actor === "j.novak"));
      const text = (e: (typeof all)[number]) => [e.actor, e.flagKey, e.serviceKey, e.note].some((v) => v?.toLowerCase().includes("evse"));
      expect(keys(await flags.listAuditLog({ limit: 200, q: "EVSE" }))).toEqual(ids(text));
      expect(ids(text).length).toBeGreaterThan(0);
    });
  });
});
