import { Badge } from "../common/Badge";
import { buildTimeIssues, daysFullyOn, driftRisks, isReviewOverdue, isStaleCandidate, LIFECYCLE_LABEL, lifecycleStage } from "../../lib/businessLogic";
import type { Flag, Service } from "../../types";
import { IconAlertTriangle } from "../icons";

export function TypeBadge({ type }: { type: Flag["type"] }) {
  return <Badge tone={type === "release" ? "info" : "neutral"}>{type}</Badge>;
}

export function StaleBadge({ flag }: { flag: Flag }) {
  if (!isStaleCandidate(flag)) return null;
  const days = daysFullyOn(flag);
  return (
    <Badge tone="critical" className="animate-pulse">
      <IconAlertTriangle width={10} height={10} />
      candidate for removal · {days}d
    </Badge>
  );
}

export function BuildTimeBadge({ flag }: { flag: Flag }) {
  const mismatches = buildTimeIssues(flag).filter((i) => i.kind === "mismatch");
  if (mismatches.length === 0) return null;
  return (
    <Badge tone="warn" title="A service has a build-time value that differs from the runtime state">
      <IconAlertTriangle width={10} height={10} />
      build-time ≠ runtime
    </Badge>
  );
}

const STAGE_TONE = { new: "neutral", testing: "info", live: "on", cleanup: "critical" } as const;

export function LifecycleBadge({ flag }: { flag: Flag }) {
  const stage = lifecycleStage(flag);
  return <Badge tone={STAGE_TONE[stage]}>{LIFECYCLE_LABEL[stage]}</Badge>;
}

export function ReviewBadge({ flag }: { flag: Flag }) {
  if (!isReviewOverdue(flag)) return null;
  return (
    <Badge tone="warn" title={`Review was due ${flag.reviewBy}`}>
      <IconAlertTriangle width={10} height={10} />
      review overdue
    </Badge>
  );
}

/** Services that may currently disagree with the flag (Rule 6). */
export function DriftBadge({ flag, services }: { flag: Flag; services: Service[] }) {
  const risks = driftRisks(flag, services);
  if (risks.length === 0) return null;
  const serviceCount = new Set(risks.map((r) => r.serviceId)).size;
  return (
    <Badge tone="critical" title="A service may still use a different value than the flag: open the flag for details">
      <IconAlertTriangle width={10} height={10} />
      drift · {serviceCount} {serviceCount === 1 ? "service" : "services"}
    </Badge>
  );
}
