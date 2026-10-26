import { ENVIRONMENTS, type Environment, type Flag, type LifecycleStage, type PromotionCheck, type Service } from "../types";

/** Release flags ON in every environment for longer than this are candidates for removal, unless an Admin set another threshold (Settings). */
export const DEFAULT_STALE_THRESHOLD_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The environment a given rung requires to already be enabled, per the test -> qa -> prod promotion order. */
const PROMOTION_PREREQUISITE: Partial<Record<Environment, Environment>> = {
  qa: "test",
  prod: "qa",
};

/** The environment that must already be disabled before this one, as flags are switched off from the top. */
const NEXT_ENVIRONMENT: Partial<Record<Environment, Environment>> = {
  test: "qa",
  qa: "prod",
};

function daysSince(iso: string, now = Date.now()): number {
  return (now - new Date(iso).getTime()) / DAY_MS;
}

/**
 * Rule 1 — Stale detection (classification).
 * A release flag ON in every environment for longer than `thresholdDays` (Settings, default 30) is a
 * "candidate for removal". The clock starts at the most recent of the three env
 * updatedAt timestamps (the moment the flag became "fully on").
 */
export function isStaleCandidate(flag: Flag, thresholdDays = DEFAULT_STALE_THRESHOLD_DAYS, now = Date.now()): boolean {
  if (flag.type !== "release") return false;
  const allOn = ENVIRONMENTS.every((env) => flag.environments[env].enabled);
  if (!allOn) return false;
  const fullyOnSince = Math.max(...ENVIRONMENTS.map((env) => new Date(flag.environments[env].updatedAt).getTime()));
  return daysSince(new Date(fullyOnSince).toISOString(), now) > thresholdDays;
}

export function daysFullyOn(flag: Flag, now = Date.now()): number | null {
  const allOn = ENVIRONMENTS.every((env) => flag.environments[env].enabled);
  if (!allOn) return null;
  const fullyOnSince = Math.max(...ENVIRONMENTS.map((env) => new Date(flag.environments[env].updatedAt).getTime()));
  return Math.floor(daysSince(new Date(fullyOnSince).toISOString(), now));
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
 * Rule 3 — Disabling order and dependents (workflow).
 * Keeps test -> qa -> prod true on the way down: a flag is switched off from the top
 * (prod, then qa, then test), so it is never ON in an environment above one where it is OFF.
 * Also blocks disabling a flag in an environment while another flag that depends on it
 * is still ON there.
 */
export function canDisable(flag: Flag, target: Environment, allFlags: Flag[]): PromotionCheck {
  const above = NEXT_ENVIRONMENT[target];
  if (above && flag.environments[above].enabled) {
    return {
      allowed: false,
      blockedBy: above,
      reason: `Disable in ${above} first — flags are switched off from the top: prod → qa → test.`,
    };
  }

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

/** Time a runtime reader has to pick up a change before it counts as missed: clients poll every 60 s at most. */
export const CHECK_IN_GRACE_MS = 5 * 60 * 1000;

export interface DriftRisk {
  serviceId: string;
  environment: Environment;
  /**
   * missed-change: the service reads this environment at runtime, but has not read it since the flag last changed there.
   * build-time: the service reads only a constant from its code, and the constant differs from the flag's state.
   */
  kind: "missed-change" | "build-time";
}

/**
 * Rule 6 — Drift between services (detection).
 * A service disagrees with the flag's state when it has not read an environment since the flag changed there (its
 * check-ins come from the consumer endpoint), or when it only reads a build-time constant that differs from it.
 * An environment a service never read from is not counted: the service may not run there.
 */
export function driftRisks(flag: Flag, services: Service[], now = Date.now()): DriftRisk[] {
  const risks: DriftRisk[] = [];
  for (const binding of flag.services) {
    if (binding.removedFromCode) continue;
    const service = services.find((s) => s.id === binding.serviceId);
    for (const environment of ENVIRONMENTS) {
      if (binding.readMode === "build-time") {
        const constant = binding.buildTimeValues?.[environment];
        if (constant !== undefined && constant !== flag.environments[environment].enabled)
          risks.push({ serviceId: binding.serviceId, environment, kind: "build-time" });
        continue;
      }
      const lastRead = service?.checkIns[environment];
      const changedAt = new Date(flag.environments[environment].updatedAt).getTime();
      if (lastRead && new Date(lastRead).getTime() < changedAt && changedAt < now - CHECK_IN_GRACE_MS) {
        risks.push({ serviceId: binding.serviceId, environment, kind: "missed-change" });
      }
    }
  }
  return risks;
}

export interface AttentionItem {
  /** Higher comes first: drift between services outweighs housekeeping. */
  weight: number;
  reason: string;
}

/**
 * Rule 7 — Attention prioritization (ranking, PRD "Business Logic" point 3).
 * Everything about a flag a human should look at, most likely to cause inconsistency first: drift (3), a build-time
 * constant that only hides behind the runtime value today (2), then an overdue review or a removal candidate (1).
 */
export function attentionItems(flag: Flag, services: Service[], staleThresholdDays = DEFAULT_STALE_THRESHOLD_DAYS, now = Date.now()): AttentionItem[] {
  const name = (id: string) => services.find((s) => s.id === id)?.key ?? id;
  const onOff = (value: boolean) => (value ? "ON" : "OFF");
  const items: AttentionItem[] = driftRisks(flag, services, now).map((risk) => ({
    weight: 3,
    reason:
      risk.kind === "missed-change"
        ? `${name(risk.serviceId)} has not read ${risk.environment} since the flag changed there, so it may still use the old value.`
        : `${name(risk.serviceId)} uses a build-time value in ${risk.environment} that differs from the flag (${onOff(!flag.environments[risk.environment].enabled)} vs ${onOff(flag.environments[risk.environment].enabled)}).`,
  }));
  for (const issue of buildTimeIssues(flag)) {
    const binding = flag.services.find((b) => b.serviceId === issue.serviceId);
    if (issue.kind !== "mismatch" || binding?.readMode !== "both") continue;
    items.push({
      weight: 2,
      reason: `${name(issue.serviceId)} has a build-time value in ${issue.environment} (${onOff(issue.buildTime!)}) that differs from the flag; it takes over if the flag is unreachable or removed.`,
    });
  }
  if (isReviewOverdue(flag, now)) items.push({ weight: 1, reason: "The review date has passed." });
  if (isStaleCandidate(flag, staleThresholdDays, now))
    items.push({ weight: 1, reason: `Candidate for removal: ON everywhere for ${daysFullyOn(flag, now)} days.` });
  return items.sort((a, b) => b.weight - a.weight);
}

/** Sum of the weights; 0 = nothing to look at. */
export const attentionScore = (flag: Flag, services: Service[], staleThresholdDays = DEFAULT_STALE_THRESHOLD_DAYS, now = Date.now()) =>
  attentionItems(flag, services, staleThresholdDays, now).reduce((sum, i) => sum + i.weight, 0);

/**
 * Flags that need attention first: by their heaviest item (drift before housekeeping, however much of it), then by the
 * sum of the weights; the original order (newest first) breaks ties.
 */
export function byAttention(flags: Flag[], services: Service[], staleThresholdDays = DEFAULT_STALE_THRESHOLD_DAYS, now = Date.now()): Flag[] {
  const rank = new Map(
    flags.map((f) => {
      const items = attentionItems(f, services, staleThresholdDays, now);
      return [f.key, [items[0]?.weight ?? 0, items.reduce((sum, i) => sum + i.weight, 0)]] as const;
    }),
  );
  return [...flags].sort((a, b) => {
    const [heaviestA, sumA] = rank.get(a.key)!;
    const [heaviestB, sumB] = rank.get(b.key)!;
    return heaviestB - heaviestA || sumB - sumA;
  });
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
 * -> cleanup (release flag on everywhere for longer than the stale threshold: remove it).
 */
export function lifecycleStage(flag: Flag, staleThresholdDays = DEFAULT_STALE_THRESHOLD_DAYS): LifecycleStage {
  if (isStaleCandidate(flag, staleThresholdDays)) return "cleanup";
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
export function isReviewOverdue(flag: Flag, now = Date.now()): boolean {
  return !!flag.reviewBy && new Date(flag.reviewBy).getTime() < now;
}
