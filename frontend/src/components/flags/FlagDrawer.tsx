import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { useStore } from "../../state/store";
import { canEnable, daysFullyOn, isStaleCandidate, migrationProgress } from "../../lib/businessLogic";
import { canEditFlags } from "../../lib/permissions";
import { ENVIRONMENTS, type Environment, type Flag } from "../../types";
import { ENV_LABEL } from "../../data/mock";
import { StatusDot } from "../common/StatusDot";
import { Toggle } from "../common/Toggle";
import { LifecycleBadge, ReviewBadge, TypeBadge } from "./FlagBadges";
import { parseTags } from "./CreateFlagModal";
import { BindingCard } from "./BindingCard";
import { RetireFlagPanel } from "./RetireFlagPanel";
import { IconAlertTriangle, IconLock, IconX } from "../icons";

function actionLabel(action: string): string {
  return action.replace(/-/g, " ");
}

export function FlagDrawer({ flag, onClose }: { flag: Flag; onClose: () => void }) {
  const { role, toggleEnvironment, auditLog, flags, updateBinding, updateFlagMeta } = useStore();
  const [blockedNotice, setBlockedNotice] = useState<{ env: Environment; reason: string } | null>(null);
  const editable = canEditFlags(role);
  const migration = migrationProgress(flag);
  const stale = isStaleCandidate(flag);

  const history = auditLog.filter((e) => e.flagKey === flag.key).slice(0, 8);

  function handleToggle(env: Environment) {
    setBlockedNotice(null);
    const result = toggleEnvironment(flag.key, env);
    if (!result.ok && result.reason) {
      setBlockedNotice({ env, reason: result.reason });
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-40 bg-ink-950/70 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.aside
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col border-l border-ink-600 bg-ink-900 shadow-2xl"
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", stiffness: 320, damping: 34 }}
      >
        <div className="flex items-start justify-between border-b border-ink-600 px-6 py-5">
          <div>
            <div className="flex items-center gap-2">
              <TypeBadge type={flag.type} />
              <LifecycleBadge flag={flag} />
              <ReviewBadge flag={flag} />
            </div>
            <h2 className="text-shell mt-2 text-lg font-semibold text-mist-100">{flag.key}</h2>
            <p className="mt-1 max-w-sm text-xs text-mist-500">{flag.description}</p>
            {flag.dependsOn && (
              <p className="text-shell mt-2 text-[11px] text-mist-500">
                requires <span className="text-mist-300">{flag.dependsOn}</span> to be on first
              </p>
            )}
          </div>
          <button onClick={onClose} className="rounded p-1 text-mist-500 hover:bg-ink-800 hover:text-mist-100">
            <IconX width={18} height={18} />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          {stale && (
            <div className="flex items-start gap-2 rounded-xl border border-signal-critical/30 bg-signal-critical-dim/20 px-3 py-2.5 text-xs text-mist-300">
              <IconAlertTriangle width={14} height={14} className="mt-0.5 shrink-0 text-signal-critical" />
              <span>
                Fully on in every environment for {daysFullyOn(flag)} days — past the 30-day stale threshold. Consider
                removing this release flag and cleaning up its guard code.
              </span>
            </div>
          )}

          <section>
            <h3 className="text-shell text-[10px] font-semibold uppercase tracking-widest text-mist-700">Details</h3>
            <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
              <label className="block">
                <span className="text-mist-500">Owner</span>
                <input
                  key={`owner-${flag.owner}`}
                  defaultValue={flag.owner ?? ""}
                  disabled={!editable}
                  onBlur={(e) => e.target.value.trim() !== (flag.owner ?? "") && updateFlagMeta(flag.key, { owner: e.target.value.trim() })}
                  className="text-shell mt-1 w-full rounded-lg border border-ink-500 bg-ink-850 px-2.5 py-1.5 text-mist-100 outline-none disabled:opacity-60"
                />
              </label>
              <label className="block">
                <span className="text-mist-500">Review by</span>
                <input
                  type="date"
                  key={`review-${flag.reviewBy}`}
                  defaultValue={flag.reviewBy?.slice(0, 10) ?? ""}
                  disabled={!editable}
                  onBlur={(e) => e.target.value !== (flag.reviewBy?.slice(0, 10) ?? "") && updateFlagMeta(flag.key, { reviewBy: e.target.value || undefined })}
                  className="text-shell mt-1 w-full rounded-lg border border-ink-500 bg-ink-850 px-2.5 py-1.5 text-mist-100 outline-none disabled:opacity-60"
                />
              </label>
              <label className="col-span-2 block">
                <span className="text-mist-500">Tags (comma separated)</span>
                <input
                  key={`tags-${(flag.tags ?? []).join(",")}`}
                  defaultValue={(flag.tags ?? []).join(", ")}
                  disabled={!editable}
                  onBlur={(e) => {
                    const next = parseTags(e.target.value);
                    if (next.join(",") !== (flag.tags ?? []).join(",")) updateFlagMeta(flag.key, { tags: next });
                  }}
                  className="text-shell mt-1 w-full rounded-lg border border-ink-500 bg-ink-850 px-2.5 py-1.5 text-mist-100 outline-none disabled:opacity-60"
                />
              </label>
            </div>
          </section>

          <section>
            <h3 className="text-shell text-[10px] font-semibold uppercase tracking-widest text-mist-700">Environment state</h3>
            <div className="mt-3 space-y-2">
              {ENVIRONMENTS.map((e) => {
                const state = flag.environments[e];
                const check = canEnable(flag, e, flags);
                const locked = editable && !state.enabled && !check.allowed;
                return (
                  <div key={e} className="rounded-xl border border-ink-600 bg-ink-850/60 px-3.5 py-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <StatusDot tone={state.enabled ? "on" : "off"} pulse={state.enabled} size={8} />
                        <span className="text-shell text-sm font-medium text-mist-100">{ENV_LABEL[e]}</span>
                        {locked && <IconLock width={12} height={12} className="text-signal-warn/70" />}
                      </div>
                      <Toggle
                        checked={state.enabled}
                        disabled={!editable || locked}
                        tone={locked ? "warn" : "on"}
                        onClick={() => handleToggle(e)}
                      />
                    </div>
                    <p className="text-shell mt-1.5 pl-[18px] text-[11px] text-mist-700">
                      last changed by {state.updatedBy} · {new Date(state.updatedAt).toLocaleDateString()}
                    </p>
                    {locked && check.reason && (
                      <p className="mt-2 flex items-center gap-1.5 pl-[18px] text-[11px] text-signal-warn">
                        <IconLock width={11} height={11} />
                        {check.reason}
                      </p>
                    )}
                    {blockedNotice?.env === e && (
                      <motion.p
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        className="mt-2 flex items-center gap-1.5 rounded border border-signal-warn/30 bg-signal-warn-dim/25 px-2 py-1.5 text-[11px] text-signal-warn"
                      >
                        <IconLock width={11} height={11} />
                        {blockedNotice.reason}
                      </motion.p>
                    )}
                  </div>
                );
              })}
            </div>
            {!editable && (
              <p className="mt-2 text-[11px] text-mist-700">Viewers can see flag state but cannot change it.</p>
            )}
          </section>

          <section>
            <div className="flex items-center justify-between">
              <h3 className="text-shell text-[10px] font-semibold uppercase tracking-widest text-mist-700">
                Assigned services
              </h3>
              <span className="text-shell text-[11px] text-mist-700">
                {migration.runtime}/{migration.total} on runtime reads
              </span>
            </div>
            <div className="mt-3 space-y-2">
              {flag.services.map((binding) => (
                <BindingCard
                  key={binding.serviceId}
                  flag={flag}
                  binding={binding}
                  editable={editable}
                  onChange={(patch) => updateBinding(flag.key, binding.serviceId, patch)}
                />
              ))}
            </div>
          </section>

          <RetireFlagPanel flag={flag} onRetired={onClose} />

          <section>
            <h3 className="text-shell text-[10px] font-semibold uppercase tracking-widest text-mist-700">Recent history</h3>
            <div className="mt-3 space-y-2.5 border-l border-ink-600 pl-4">
              {history.length === 0 && <p className="text-xs text-mist-700">No changes recorded yet.</p>}
              {history.map((entry) => (
                <div key={entry.id} className="relative">
                  <span className="absolute -left-[18.5px] top-1.5 h-1.5 w-1.5 rounded-full bg-ink-500" />
                  <p className="text-shell text-xs text-mist-300">
                    <span className="font-medium text-mist-100">{entry.actor}</span> {actionLabel(entry.action)}
                    {entry.environment ? ` · ${entry.environment}` : ""}
                  </p>
                  <p className="text-shell text-[10px] text-mist-700">{new Date(entry.timestamp).toLocaleString()}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </motion.aside>
    </AnimatePresence>
  );
}