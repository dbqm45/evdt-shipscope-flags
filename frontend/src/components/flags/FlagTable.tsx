import { Fragment, useState, type ReactNode } from "react";
import clsx from "clsx";
import { ENVIRONMENTS, type Environment, type Flag } from "../../types";
import { BuildTimeBadge, LifecycleBadge, ReviewBadge, StaleBadge, TypeBadge } from "./FlagBadges";
import { IconChevronRight } from "../icons";
import { buildTimeIssues, isReviewOverdue, isStaleCandidate } from "../../lib/businessLogic";

function relativeTime(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

function latestChange(flag: Flag) {
  const env = ENVIRONMENTS.reduce<Environment>(
    (best, e) => (new Date(flag.environments[e].updatedAt) > new Date(flag.environments[best].updatedAt) ? e : best),
    ENVIRONMENTS[0],
  );
  return { env, ...flag.environments[env] };
}

const TH = "px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-mist-500";

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-shell text-[10px] font-semibold uppercase tracking-widest text-mist-700">{label}</p>
      <div className="mt-1 text-xs">{children}</div>
    </div>
  );
}

export function FlagTable({ flags, onSelect }: { flags: Flag[]; onSelect: (flagKey: string) => void }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="overflow-x-auto rounded-3xl border border-ink-600 bg-ink-850">
      <table className="w-full min-w-[860px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-ink-600">
            <th className={TH}>Flag</th>
            <th className={TH}>Type</th>
            <th className={TH}>Stage</th>
            {ENVIRONMENTS.map((e) => (
              <th key={e} className={TH}>
                {e}
              </th>
            ))}
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-700/60">
          {flags.map((flag) => {
            const last = latestChange(flag);
            const open = expanded.has(flag.id);
            return (
              <Fragment key={flag.id}>
                <tr onClick={() => onSelect(flag.key)} className="group cursor-pointer transition-colors hover:bg-ink-800/50">
                  <td className="px-4 py-3.5">
                    <span className="text-shell block font-medium text-mist-100">{flag.key}</span>
                    {(isStaleCandidate(flag) || buildTimeIssues(flag).some((i) => i.kind === "mismatch") || isReviewOverdue(flag)) && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <StaleBadge flag={flag} />
                        <BuildTimeBadge flag={flag} />
                        <ReviewBadge flag={flag} />
                      </div>
                    )}
                    <p className="mt-0.5 max-w-sm truncate text-xs text-mist-500">{flag.description}</p>
                    {flag.tags && flag.tags.length > 0 && (
                      <p className="text-shell mt-0.5 text-[11px] text-mist-700">{flag.tags.map((t) => `#${t}`).join(" ")}</p>
                    )}
                    {flag.dependsOn && <p className="text-shell mt-0.5 text-[11px] text-mist-700">requires {flag.dependsOn}</p>}
                  </td>
                  <td className="px-4 py-3.5">
                    <TypeBadge type={flag.type} />
                  </td>
                  <td className="px-4 py-3.5">
                    <LifecycleBadge flag={flag} />
                  </td>
                  {ENVIRONMENTS.map((e) => {
                    const s = flag.environments[e];
                    return (
                      <td key={e} className="px-4 py-3.5">
                        <span className={clsx("text-shell inline-flex items-center gap-1.5 text-xs font-semibold", s.enabled ? "text-signal-on" : "text-mist-700")}>
                          <span className={clsx("h-1.5 w-1.5 rounded-full", s.enabled ? "bg-signal-on" : "bg-signal-off")} />
                          {s.enabled ? "ON" : "OFF"}
                        </span>
                      </td>
                    );
                  })}
                  <td className="px-4 py-3.5 text-right">
                    <button
                      type="button"
                      aria-expanded={open}
                      aria-label={open ? "Hide details" : "Show details"}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle(flag.id);
                      }}
                      className="rounded-lg p-1.5 text-mist-700 transition-colors hover:bg-ink-700 hover:text-mist-100"
                    >
                      <IconChevronRight width={14} height={14} className={clsx("transition-transform", open && "rotate-90")} />
                    </button>
                  </td>
                </tr>
                {open && (
                  <tr className="bg-ink-900/40">
                    <td colSpan={7} className="px-4 py-3.5">
                      <div className="grid grid-cols-2 gap-x-8 gap-y-3 pl-1 sm:grid-cols-4">
                        <Meta label="Owner">
                          <p className="text-shell text-mist-300">{flag.owner ?? "—"}</p>
                        </Meta>
                        <Meta label="Added">
                          <p className="text-mist-300">{flag.createdBy}</p>
                          <p className="text-mist-500">{relativeTime(flag.createdAt)}</p>
                        </Meta>
                        <Meta label="Last change">
                          <p className="text-mist-300">
                            {last.env} <span className={last.enabled ? "text-signal-on" : "text-mist-500"}>{last.enabled ? "enabled" : "disabled"}</span> by {last.updatedBy}
                          </p>
                          <p className="text-mist-500">{relativeTime(last.updatedAt)}</p>
                        </Meta>
                        <Meta label="Review by">
                          <p className="text-mist-300">{flag.reviewBy ? new Date(flag.reviewBy).toLocaleDateString() : "—"}</p>
                        </Meta>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
          {flags.length === 0 && (
            <tr>
              <td colSpan={7} className="px-4 py-10 text-center text-sm text-mist-500">
                No flags match your filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
