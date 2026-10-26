import { useEffect, useState } from "react";
import clsx from "clsx";
import { useAuditLog } from "../lib/useAuditLog";
import { Badge } from "../components/common/Badge";
import { IconSearch } from "../components/icons";
import { AUDIT_ACTIONS, type AuditAction } from "../types";

const ACTION_TONE: Record<AuditAction, "on" | "off" | "warn" | "critical" | "info" | "neutral" | "amber"> = {
  "flag-created": "amber",
  "env-enabled": "on",
  "env-disabled": "neutral",
  "promotion-blocked": "critical",
  "service-assigned": "info",
  "service-registered": "info",
  "credential-rotated": "warn",
  "binding-updated": "info",
  "flag-retired": "neutral",
  "flag-updated": "neutral",
  "notification-failed": "critical",
};

function actionLabel(action: AuditAction): string {
  return action.replace(/-/g, " ");
}

/** Typing waits this long before the server is asked again. */
const SEARCH_DELAY_MS = 300;

export function AuditLogPage() {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState<AuditAction | "all">("all");

  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const {
    entries: filtered,
    hasMore,
    loading,
    error,
    loadMore,
  } = useAuditLog({ q: search || undefined, action: actionFilter === "all" ? undefined : actionFilter });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-mist-100">Audit log</h1>
        <p className="mt-1 text-sm text-mist-500">Every flag and service change — who, when, what.</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-72">
          <IconSearch width={14} height={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mist-700" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search actor, flag, service…"
            className="text-shell w-full rounded-xl border border-ink-600 bg-ink-850 py-2 pl-8 pr-3 text-sm text-mist-100 outline-none placeholder:text-mist-700 focus:border-accent/50"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setActionFilter("all")}
            className={clsx(
              "text-shell rounded-xl border px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-wide transition-colors",
              actionFilter === "all" ? "border-accent bg-accent text-ink-950" : "border-ink-600 text-mist-500 hover:text-mist-300",
            )}
          >
            All
          </button>
          {AUDIT_ACTIONS.map((a) => (
            <button
              key={a}
              onClick={() => setActionFilter(a)}
              className={clsx(
                "text-shell rounded-xl border px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-wide transition-colors",
                actionFilter === a ? "border-accent bg-accent text-ink-950" : "border-ink-600 text-mist-500 hover:text-mist-300",
              )}
            >
              {actionLabel(a)}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-ink-600 bg-ink-850 shadow-panel">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-ink-600 bg-ink-800/60 text-left">
              <th className="text-shell px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-mist-700">When</th>
              <th className="text-shell px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-mist-700">Actor</th>
              <th className="text-shell px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-mist-700">Action</th>
              <th className="text-shell px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-mist-700">Subject</th>
              <th className="text-shell px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-mist-700">Change</th>
              <th className="text-shell px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-mist-700">Note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-700/60">
            {filtered.map((e) => (
              <tr key={e.id} className="hover:bg-ink-800/30">
                <td className="text-shell whitespace-nowrap px-4 py-2.5 text-xs text-mist-700">
                  {new Date(e.timestamp).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </td>
                <td className="text-shell px-4 py-2.5 text-xs text-mist-300">{e.actor}</td>
                <td className="px-4 py-2.5">
                  <Badge tone={ACTION_TONE[e.action]}>{actionLabel(e.action)}</Badge>
                </td>
                <td className="text-shell px-4 py-2.5 text-xs text-mist-300">
                  {e.flagKey ?? e.serviceKey ?? "—"}
                  {e.environment && <span className="text-mist-700"> · {e.environment}</span>}
                </td>
                <td className="text-shell px-4 py-2.5 text-xs text-mist-500">
                  {e.from && e.to ? (
                    <span>
                      {e.from} <span className="text-mist-700">→</span> {e.to}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="max-w-xs px-4 py-2.5 text-xs text-mist-700">{e.note ?? ""}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-xs text-mist-700">
                  {loading ? "Loading…" : "No matching entries."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {error && (
        <p role="alert" className="text-xs text-signal-critical">
          Could not load the audit log: {error}
        </p>
      )}
      {hasMore && (
        <button
          onClick={loadMore}
          disabled={loading}
          className="text-shell rounded-xl border border-ink-500 px-3.5 py-2 text-xs font-semibold text-mist-300 hover:text-mist-100 disabled:opacity-40"
        >
          {loading ? "Loading…" : "Load older entries"}
        </button>
      )}
    </div>
  );
}
