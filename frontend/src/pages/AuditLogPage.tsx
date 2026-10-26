import { useMemo, useState } from "react";
import clsx from "clsx";
import { useStore } from "../state/store";
import { Badge } from "../components/common/Badge";
import { IconSearch } from "../components/icons";
import type { AuditAction } from "../types";

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
};

function actionLabel(action: AuditAction): string {
  return action.replace(/-/g, " ");
}

export function AuditLogPage() {
  const { auditLog } = useStore();
  const [query, setQuery] = useState("");
  const [actionFilter, setActionFilter] = useState<AuditAction | "all">("all");

  const actions = useMemo(() => Array.from(new Set(auditLog.map((e) => e.action))), [auditLog]);

  const filtered = useMemo(() => {
    return auditLog.filter((e) => {
      if (actionFilter !== "all" && e.action !== actionFilter) return false;
      if (!query) return true;
      const haystack = `${e.actor} ${e.flagKey ?? ""} ${e.serviceKey ?? ""} ${e.note ?? ""}`.toLowerCase();
      return haystack.includes(query.toLowerCase());
    });
  }, [auditLog, query, actionFilter]);

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
          {actions.map((a) => (
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
                  No matching entries.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}