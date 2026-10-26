import { useMemo, useState } from "react";
import clsx from "clsx";
import { useStore } from "../state/store";
import { canEditFlags } from "../lib/permissions";
import { FlagTable } from "../components/flags/FlagTable";
import { FlagDrawer } from "../components/flags/FlagDrawer";
import { CreateFlagModal } from "../components/flags/CreateFlagModal";
import { useSelectedFlag } from "../lib/useSelectedFlag";
import { IconPlus, IconSearch } from "../components/icons";
import { lifecycleStage, LIFECYCLE_LABEL } from "../lib/businessLogic";
import type { FlagType, LifecycleStage } from "../types";

const TYPE_FILTERS: Array<{ label: string; value: FlagType | "all" }> = [
  { label: "All types", value: "all" },
  { label: "Release", value: "release" },
  { label: "Feature", value: "feature" },
];

export function DashboardPage() {
  const { flags, role } = useStore();
  const { selectedFlag, select } = useSelectedFlag();
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<FlagType | "all">("all");
  const [creating, setCreating] = useState(false);
  const [stageFilter, setStageFilter] = useState<LifecycleStage | "all">("all");
  const [tagFilter, setTagFilter] = useState("all");
  const allTags = useMemo(() => [...new Set(flags.flatMap((f) => f.tags ?? []))].sort(), [flags]);

  const filtered = useMemo(() => {
    return flags.filter((f) => {
      if (typeFilter !== "all" && f.type !== typeFilter) return false;
      if (stageFilter !== "all" && lifecycleStage(f) !== stageFilter) return false;
      if (tagFilter !== "all" && !(f.tags ?? []).includes(tagFilter)) return false;
      if (query && !f.key.toLowerCase().includes(query.toLowerCase()) && !f.description.toLowerCase().includes(query.toLowerCase())) return false;
      return true;
    });
  }, [flags, query, typeFilter, stageFilter, tagFilter]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-mist-100">Flags</h1>
          <p className="mt-1 text-sm text-mist-500">Every feature and release flag: status per environment, who added it, and who changed it last.</p>
        </div>
        {canEditFlags(role) && (
          <button
            onClick={() => setCreating(true)}
            className="text-shell flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-2 text-xs font-semibold text-ink-950 transition-opacity hover:opacity-90"
          >
            <IconPlus width={14} height={14} />
            Create flag
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-72">
          <IconSearch width={14} height={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mist-700" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search flags…"
            className="text-shell w-full rounded-xl border border-ink-600 bg-ink-850 py-2 pl-8 pr-3 text-sm text-mist-100 outline-none placeholder:text-mist-700 focus:border-accent/50"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <select
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value as LifecycleStage | "all")}
            className="text-shell rounded-xl border border-ink-600 bg-ink-850 px-2.5 py-1.5 text-[11px] uppercase tracking-wide text-mist-300 outline-none"
          >
            <option value="all">All stages</option>
            {(Object.keys(LIFECYCLE_LABEL) as LifecycleStage[]).map((s) => (
              <option key={s} value={s}>
                {LIFECYCLE_LABEL[s]}
              </option>
            ))}
          </select>
          {allTags.length > 0 && (
            <select
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              className="text-shell rounded-xl border border-ink-600 bg-ink-850 px-2.5 py-1.5 text-[11px] uppercase tracking-wide text-mist-300 outline-none"
            >
              <option value="all">All tags</option>
              {allTags.map((t) => (
                <option key={t} value={t}>
                  #{t}
                </option>
              ))}
            </select>
          )}
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setTypeFilter(f.value)}
              className={clsx(
                "text-shell rounded-xl border px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-wide transition-colors",
                typeFilter === f.value ? "border-accent bg-accent text-ink-950" : "border-ink-600 text-mist-500 hover:text-mist-300",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <FlagTable flags={filtered} onSelect={select} />

      {selectedFlag && <FlagDrawer flag={selectedFlag} onClose={() => select(null)} />}
      {creating && (
        <CreateFlagModal
          onClose={() => setCreating(false)}
          onCreated={(key) => {
            setCreating(false);
            select(key);
          }}
        />
      )}
    </div>
  );
}
