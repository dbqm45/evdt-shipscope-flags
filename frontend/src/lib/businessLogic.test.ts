import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { daysBefore, makeBinding, makeFlag, makeService, NOW } from "../test/factories";
import type { Service } from "../types";
import {
  attentionItems,
  byAttention,
  buildTimeIssues,
  canDisable,
  canEnable,
  canRetire,
  daysFullyOn,
  driftRisks,
  isReviewOverdue,
  isStaleCandidate,
  lifecycleStage,
  migrationProgress,
  STALE_THRESHOLD_DAYS,
} from "./businessLogic";

const ALL = ["test", "qa", "prod"] as const;
const serviceName = (id: string) => `svc:${id}`;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("isStaleCandidate / daysFullyOn (rule 1)", () => {
  it("flags a release flag that has been ON everywhere for longer than the threshold", () => {
    const flag = makeFlag({ key: "a", on: [...ALL], changedDaysAgo: STALE_THRESHOLD_DAYS + 1 });
    expect(isStaleCandidate(flag)).toBe(true);
    expect(daysFullyOn(flag)).toBe(STALE_THRESHOLD_DAYS + 1);
  });

  it("does not flag it before the threshold", () => {
    expect(isStaleCandidate(makeFlag({ key: "a", on: [...ALL], changedDaysAgo: STALE_THRESHOLD_DAYS - 1 }))).toBe(false);
  });

  it("never flags a feature flag", () => {
    expect(isStaleCandidate(makeFlag({ key: "a", type: "feature", on: [...ALL], changedDaysAgo: 365 }))).toBe(false);
  });

  it("does not flag a flag that is OFF in any environment", () => {
    const flag = makeFlag({ key: "a", on: ["test", "qa"], changedDaysAgo: 365 });
    expect(isStaleCandidate(flag)).toBe(false);
    expect(daysFullyOn(flag)).toBeNull();
  });

  it("starts the clock at the most recent environment change", () => {
    const flag = makeFlag({ key: "a", on: [...ALL], changedDaysAgo: 100 });
    flag.environments.prod.updatedAt = new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
    expect(isStaleCandidate(flag)).toBe(false);
    expect(daysFullyOn(flag)).toBe(2);
  });
});

describe("canEnable (rule 2: promotion order and dependencies)", () => {
  it("always allows enabling in test", () => {
    expect(canEnable(makeFlag({ key: "a" }), "test")).toEqual({ allowed: true });
  });

  it("requires test before qa and qa before prod", () => {
    expect(canEnable(makeFlag({ key: "a" }), "qa")).toMatchObject({ allowed: false, blockedBy: "test" });
    expect(canEnable(makeFlag({ key: "a", on: ["test"] }), "prod")).toMatchObject({ allowed: false, blockedBy: "qa" });
    expect(canEnable(makeFlag({ key: "a", on: ["test", "qa"] }), "prod")).toEqual({ allowed: true });
  });

  it("blocks a dependent flag while its dependency is OFF in the target environment", () => {
    const backend = makeFlag({ key: "backend", on: ["test"] });
    const frontend = makeFlag({ key: "frontend", dependsOn: "backend", on: ["test"] });
    expect(canEnable(frontend, "qa", [backend, frontend])).toMatchObject({ allowed: false, blockedByFlag: "backend" });

    backend.environments.qa.enabled = true;
    expect(canEnable(frontend, "qa", [backend, frontend])).toEqual({ allowed: true });
  });

  it("checks promotion order before the dependency", () => {
    const backend = makeFlag({ key: "backend" });
    const frontend = makeFlag({ key: "frontend", dependsOn: "backend" });
    expect(canEnable(frontend, "qa", [backend, frontend])).toMatchObject({ allowed: false, blockedBy: "test" });
  });
});

describe("canDisable (rule 3: dependents)", () => {
  it("blocks disabling while a dependent flag is ON in that environment", () => {
    const backend = makeFlag({ key: "backend", on: ["test", "qa"] });
    const frontend = makeFlag({ key: "frontend", dependsOn: "backend", on: ["test"] });
    const all = [backend, frontend];
    expect(canDisable(backend, "test", all)).toMatchObject({ allowed: false, blockedByFlag: "frontend" });
    expect(canDisable(backend, "qa", all)).toEqual({ allowed: true });
  });

  it("names every active dependent in the reason", () => {
    const backend = makeFlag({ key: "backend", on: ["test"] });
    const all = [backend, makeFlag({ key: "web", dependsOn: "backend", on: ["test"] }), makeFlag({ key: "app", dependsOn: "backend", on: ["test"] })];
    expect(canDisable(backend, "test", all).reason).toContain('"web", "app"');
  });
});

describe("buildTimeIssues (rule 4)", () => {
  it("ignores services that read the flag only at runtime or no longer reference it", () => {
    const flag = makeFlag({
      key: "a",
      services: [makeBinding("s1"), makeBinding("s2", { readMode: "both", removedFromCode: true })],
    });
    expect(buildTimeIssues(flag)).toEqual([]);
  });

  it("reports unrecorded build-time values and values that differ from runtime", () => {
    const flag = makeFlag({
      key: "a",
      on: ["test"],
      services: [makeBinding("s1", { readMode: "both", buildTimeValues: { test: true, qa: true } })],
    });
    expect(buildTimeIssues(flag)).toEqual([
      { serviceId: "s1", environment: "qa", kind: "mismatch", runtime: false, buildTime: true },
      { serviceId: "s1", environment: "prod", kind: "unknown", runtime: false },
    ]);
  });
});

describe("canRetire (rule 5)", () => {
  it("allows retiring when every service dropped the flag or falls back to the same value", () => {
    const flag = makeFlag({
      key: "a",
      on: ["test"],
      services: [
        makeBinding("s1", { removedFromCode: true }),
        makeBinding("s2", { readMode: "build-time", buildTimeValues: { test: true, qa: false, prod: false } }),
      ],
    });
    expect(canRetire(flag, [flag], serviceName)).toEqual({ allowed: true, blockers: [] });
  });

  it("lists every reason it is not safe", () => {
    const flag = makeFlag({
      key: "a",
      on: ["test", "qa", "prod"],
      services: [makeBinding("s1"), makeBinding("s2", { readMode: "both", buildTimeValues: { test: true, qa: true, prod: false } })],
    });
    const dependent = makeFlag({ key: "b", dependsOn: "a" });
    const { allowed, blockers } = canRetire(flag, [flag, dependent], serviceName);
    expect(allowed).toBe(false);
    expect(blockers).toEqual([
      '"b" depends on this flag.',
      "svc:s1 still reads this flag at runtime — remove it from the code first, otherwise it loses the value.",
      "svc:s2: on prod it would switch from ON to OFF.",
    ]);
  });
});

describe("lifecycleStage, isReviewOverdue, migrationProgress", () => {
  it("derives the stage from environment state", () => {
    expect(lifecycleStage(makeFlag({ key: "a" }))).toBe("new");
    expect(lifecycleStage(makeFlag({ key: "a", on: ["test"] }))).toBe("testing");
    expect(lifecycleStage(makeFlag({ key: "a", on: [...ALL] }))).toBe("live");
    expect(lifecycleStage(makeFlag({ key: "a", on: [...ALL], changedDaysAgo: STALE_THRESHOLD_DAYS + 1 }))).toBe("cleanup");
  });

  it("marks a review date in the past as overdue", () => {
    expect(isReviewOverdue(makeFlag({ key: "a", reviewBy: "2026-10-25" }))).toBe(true);
    expect(isReviewOverdue(makeFlag({ key: "a", reviewBy: "2026-11-01" }))).toBe(false);
    expect(isReviewOverdue(makeFlag({ key: "a" }))).toBe(false);
  });

  it("counts services already on runtime reads", () => {
    const flag = makeFlag({ key: "a", services: [makeBinding("s1"), makeBinding("s2", { readMode: "both" }), makeBinding("s3")] });
    expect(migrationProgress(flag)).toEqual({ runtime: 2, total: 3 });
  });
});

describe("driftRisks (rule 6)", () => {
  const reader = (checkIns: Service["checkIns"]): Service => ({ ...makeService("svc-api", "orders-api"), checkIns });

  it("flags a runtime reader that has not read an environment since the flag changed there", () => {
    const flag = makeFlag({ key: "f", on: ["test"], changedDaysAgo: 1, services: [makeBinding("svc-api")] });

    expect(driftRisks(flag, [reader({ test: daysBefore(2), prod: daysBefore(0) })])).toEqual([
      { serviceId: "svc-api", environment: "test", kind: "missed-change" },
    ]);
    expect(driftRisks(flag, [reader({ test: daysBefore(0.5), qa: daysBefore(0.5), prod: daysBefore(0.5) })])).toEqual([]);
  });

  it("ignores environments the service never read, changes still inside the polling grace, and removed references", () => {
    const changedNow = makeFlag({ key: "f", services: [makeBinding("svc-api")] });
    changedNow.environments.prod.updatedAt = new Date(NOW.getTime() - 60_000).toISOString();
    expect(driftRisks(changedNow, [reader({ prod: daysBefore(1) })])).toEqual([]);

    const flag = makeFlag({ key: "f", changedDaysAgo: 1, services: [makeBinding("svc-api")] });
    expect(driftRisks(flag, [reader({})])).toEqual([]);
    expect(driftRisks({ ...flag, services: [makeBinding("svc-api", { removedFromCode: true })] }, [reader({ test: daysBefore(2) })])).toEqual([]);
  });

  it("flags a build-time-only reader whose constant differs from the flag", () => {
    const flag = makeFlag({
      key: "f",
      on: ["test"],
      services: [makeBinding("svc-api", { readMode: "build-time", buildTimeValues: { test: false, qa: false } })],
    });
    expect(driftRisks(flag, [reader({})])).toEqual([{ serviceId: "svc-api", environment: "test", kind: "build-time" }]);
  });
});

describe("attentionItems and byAttention (rule 7)", () => {
  const services = [{ ...makeService("svc-api", "orders-api"), checkIns: { prod: daysBefore(3) } }];

  it("lists drift first, then a hidden build-time value, then housekeeping", () => {
    const flag = makeFlag({
      key: "f",
      changedDaysAgo: 1,
      reviewBy: daysBefore(1),
      services: [makeBinding("svc-api", { readMode: "both", buildTimeValues: { test: true, qa: false, prod: false } })],
    });

    expect(attentionItems(flag, services).map((i) => [i.weight, i.reason])).toEqual([
      [3, "orders-api has not read prod since the flag changed there, so it may still use the old value."],
      [2, "orders-api has a build-time value in test (ON) that differs from the flag; it takes over if the flag is unreachable or removed."],
      [1, "The review date has passed."],
    ]);
  });

  it("puts the flags that need attention first and keeps the original order otherwise", () => {
    const quiet = makeFlag({ key: "quiet", changedDaysAgo: 5, services: [makeBinding("svc-api")] });
    const overdue = makeFlag({ key: "overdue", changedDaysAgo: 5, reviewBy: daysBefore(1) });
    const drifting = makeFlag({ key: "drifting", changedDaysAgo: 1, services: [makeBinding("svc-api")] });
    const another = makeFlag({ key: "another", changedDaysAgo: 5 });
    // Overdue and a removal candidate: more housekeeping, but no drift.
    const neglected = makeFlag({ key: "neglected", on: [...ALL], changedDaysAgo: STALE_THRESHOLD_DAYS + 5, reviewBy: daysBefore(1) });

    expect(byAttention([quiet, overdue, another, neglected, drifting], services).map((f) => f.key)).toEqual([
      "drifting",
      "neglected",
      "overdue",
      "quiet",
      "another",
    ]);
  });
});
