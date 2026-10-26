import { ENVIRONMENTS, type Environment, type Flag, type LifecycleStage, type PromotionCheck } from "../types";

/** Release flags ON in every environment for longer than this are candidates for removal. */
export const STALE_THRESHOLD_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The environment a given rung requires to already be enabled, per the test -> qa -> prod promotion order. */
const PROMOTION_PREREQUISITE: Partial<Record<Environment, Environment>> = {
  qa: "test",
  prod: "qa",
};

function daysSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / DAY_MS;
}

/**
 * Rule 1 — Stale detection (classification).
 * A release flag ON in every environment for longer than STALE_THRESHOLD_DAYS is a
 * "candidate for removal". The clock starts at the most recent of the three env
 * updatedAt timestamps (the moment the flag became "fully on").
 */
export function isStaleCandidate(flag: Flag): boolean {
  if (flag.type !== "release") return false;
  const allOn = ENVIRONMENTS.every((env) => flag.environments[env].enabled);
  if (!allOn) return false;
  const fullyOnSince = Math.max(...ENVIRONMENTS.map((env) => new Date(flag.environments[env].updatedAt).getTime()));
  return daysSince(new Date(fullyOnSince).toISOString()) > STALE_THRESHOLD_DAYS;
}

export function daysFullyOn(flag: Flag): number | null {
  const allOn = ENVIRONMENTS.every((env) => flag.environments[env].enabled);
  if (!allOn) return null;
  const fullyOnSince = Math.max(...ENVIRONMENTS.map((env) => new Date(flag.environments[env].updatedAt).getTime()));
  return Math.floor(daysSince(new Date(fullyOnSince).toISOString()));
}

/**
 * Rule 2 — Environment promotion order (workflow).
 * Blocks enabling a flag in a higher environment before it has proven itself in the
 * environment below (test -> qa -> prod).
 */
export function canEnable(flag: Flag, target: Environment, allFlags: Flag[] = []): PromotionCheck {
  const prerequisite = PROMOTION_PREREQUISITE[target];
  if (prerequisite && !flag.environments[prerequisite].enabled) {
    return {
      allowed: false,
      blockedBy: prerequisite,
      reason: `Enable in ${prerequisite} first — flags promote test → qa → prod in order.`,
    };
  }

  if (flag.dependsOn) {
    const dependency = allFlags.find((f) => f.key === flag.dependsOn);
    if (dependency && !dependency.environments[target].enabled) {
      return {
        allowed: false,
        blockedByFlag: dependency.key,
        reason: `Enable "${dependency.key}" in ${target} first — this flag depends on it (e.g. backend before frontend).`,
      };
    }
  }

  return { allowed: true };
}

/**
 * Rule 3 — Dependents (workflow).
 * Blocks disabling a flag in an environment while another flag that depends on it
 * is still ON there.
 */
export function canDisable(flag: Flag, target: Environment, allFlags: Flag[]): PromotionCheck {
  const activeDependents = allFlags.filter((f) => f.dependsOn === flag.key && f.environments[target].enabled);
  if (activeDependents.length === 0) return { allowed: true };
  return {
    allowed: false,
    blockedByFlag: activeDependents[0].key,
    reason: `Disable ${activeDependents.map((f) => `"${f.key}"`).join(", ")} in ${target} first — it depends on this flag.`,
  };
}

export function migrationProgress(flag: Flag): { runtime: number; total: number } {
  const total = flag.services.length;
  const runtime = flag.services.filter((s) => s.readMode === "runtime").length;
  return { runtime, total };
}

export interface BuildTimeIssue {
  serviceId: string;
  environment: Environment;
  kind: "mismatch" | "unknown";
  runtime: boolean;
  buildTime?: boolean;
}

/**
 * Rule 4 — Build-time vs runtime consistency.
 * A service that carries a build-time constant (build-time or both) silently disagrees with
 * the runtime state when the two differ, and would flip to the constant the moment the
 * runtime flag is removed. Unknown = the constant has not been recorded for that environment.
 */
export function buildTimeIssues(flag: Flag): BuildTimeIssue[] {
  const issues: BuildTimeIssue[] = [];
  for (const binding of flag.services) {
    if (binding.readMode === "runtime" || binding.removedFromCode) continue;
    for (const environment of ENVIRONMENTS) {
      const runtime = flag.environments[environment].enabled;
      const buildTime = binding.buildTimeValues?.[environment];
      if (buildTime === undefined) issues.push({ serviceId: binding.serviceId, environment, kind: "unknown", runtime });
      else if (buildTime !== runtime) issues.push({ serviceId: binding.serviceId, environment, kind: "mismatch", runtime, buildTime });
    }
  }
  return issues;
}

export interface RetireCheck {
  allowed: boolean;
  blockers: string[];
}

/**
 * Rule 5 — Safe retirement.
 * Removing a flag must not change behaviour anywhere. It is only allowed when no other
 * flag depends on it and every service either dropped the flag from its code, or falls back
 * to a recorded build-time value equal to what it gets from runtime today.
 */
export function canRetire(flag: Flag, allFlags: Flag[], serviceName: (id: string) => string): RetireCheck {
  const blockers: string[] = [];

  for (const dependent of allFlags.filter((f) => f.dependsOn === flag.key)) {
    blockers.push(`"${dependent.key}" depends on this flag.`);
  }

  for (const binding of flag.services) {
    if (binding.removedFromCode) continue;
    const name = serviceName(binding.serviceId);
    if (binding.readMode === "runtime") {
      blockers.push(`${name} still reads this flag at runtime — remove it from the code first, otherwise it loses the value.`);
      continue;
    }
    const issues = buildTimeIssues(flag).filter((i) => i.serviceId === binding.serviceId);
    for (const issue of issues) {
      blockers.push(
        issue.kind === "unknown"
          ? `${name}: build-time value for ${issue.environment} is not recorded.`
          : `${name}: on ${issue.environment} it would switch from ${issue.runtime ? "ON" : "OFF"} to ${issue.buildTime ? "ON" : "OFF"}.`,
      );
    }
  }

  return { allowed: blockers.length === 0, blockers };
}

/**
 * Lifecycle stage, derived from state:
 * new (off everywhere) -> testing (on in test/qa, off in prod) -> live (on in prod)
 * -> cleanup (release flag on everywhere for over 30 days: remove it).
 */
export function lifecycleStage(flag: Flag): LifecycleStage {
  if (isStaleCandidate(flag)) return "cleanup";
  if (flag.environments.prod.enabled) return "live";
  if (ENVIRONMENTS.some((e) => flag.environments[e].enabled)) return "testing";
  return "new";
}

export const LIFECYCLE_LABEL: Record<LifecycleStage, string> = {
  new: "new",
  testing: "in testing",
  live: "live",
  cleanup: "to clean up",
};

/** The review date has passed. */
export function isReviewOverdue(flag: Flag): boolean {
  return !!flag.reviewBy && new Date(flag.reviewBy).getTime() < Date.now();
}
