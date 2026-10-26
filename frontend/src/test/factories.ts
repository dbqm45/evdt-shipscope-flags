import type { Environment, Flag, FlagServiceBinding, Service } from "../types";

/** Fixed "now" for tests that depend on dates (stale detection, review dates). */
export const NOW = new Date("2026-10-26T12:00:00.000Z");

export function daysBefore(days: number, from: Date = NOW): string {
  return new Date(from.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

/** A flag that is OFF everywhere unless `on` lists environments; every environment was last changed `changedDaysAgo` days before NOW. */
export function makeFlag(overrides: Partial<Flag> & { key: string; on?: Environment[]; changedDaysAgo?: number }): Flag {
  const { on = [], changedDaysAgo = 1, ...rest } = overrides;
  const updatedAt = daysBefore(changedDaysAgo);
  const state = (env: Environment) => ({ enabled: on.includes(env), updatedAt, updatedBy: "tester" });
  return {
    id: `flag-${rest.key}`,
    description: "",
    type: "release",
    createdAt: daysBefore(60),
    createdBy: "tester",
    environments: { test: state("test"), qa: state("qa"), prod: state("prod") },
    services: [],
    ...rest,
  };
}

export function makeBinding(serviceId: string, overrides: Partial<FlagServiceBinding> = {}): FlagServiceBinding {
  return { serviceId, readMode: "runtime", lastCheckInAt: daysBefore(0), driftSuspected: false, ...overrides };
}

export function makeService(id: string, key = id): Service {
  return {
    id,
    key,
    name: key,
    registeredAt: daysBefore(90),
    registeredBy: "tester",
    hasCredential: true,
    credentialStatus: "active",
    credentialLastRotated: daysBefore(30),
    lastCheckInAt: daysBefore(0),
  };
}
