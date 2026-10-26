import { useState } from "react";
import { useStore } from "../../state/store";
import { canRetire } from "../../lib/businessLogic";
import { canEditFlags } from "../../lib/permissions";
import type { Flag } from "../../types";
import { IconAlertTriangle, IconCheck } from "../icons";

export function RetireFlagPanel({ flag, onRetired }: { flag: Flag; onRetired: () => void }) {
  const { flags, services, role, retireFlag } = useStore();
  const [confirming, setConfirming] = useState(false);
  const check = canRetire(flag, flags, (id) => services.find((s) => s.id === id)?.key ?? id);
  const editable = canEditFlags(role);

  return (
    <section>
      <h3 className="text-shell text-[10px] font-semibold uppercase tracking-widest text-mist-700">Removing this flag</h3>

      {check.allowed ? (
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-signal-on/30 bg-signal-on-dim/20 px-3.5 py-3 text-xs text-mist-300">
          <IconCheck width={14} height={14} className="mt-0.5 shrink-0 text-signal-on" />
          Safe to remove: no service depends on it, and every service either dropped it from code or falls back to the same value it has now.
        </p>
      ) : (
        <div className="mt-3 rounded-xl border border-signal-warn/30 bg-signal-warn-dim/20 px-3.5 py-3">
          <p className="flex items-center gap-2 text-xs font-medium text-signal-warn">
            <IconAlertTriangle width={13} height={13} />
            Not safe to remove yet — a feature could silently switch off
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-mist-300">
            {check.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      )}

      {editable && (
        <div className="mt-3 flex items-center gap-2">
          {!confirming ? (
            <button
              type="button"
              disabled={!check.allowed}
              onClick={() => setConfirming(true)}
              className="text-shell rounded-xl border border-ink-500 px-3.5 py-2 text-xs font-medium text-mist-300 transition-colors hover:border-signal-critical/50 hover:text-signal-critical disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-ink-500 disabled:hover:text-mist-300"
            >
              Retire flag
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  if (retireFlag(flag.key).ok) onRetired();
                }}
                className="text-shell rounded-xl bg-signal-critical px-3.5 py-2 text-xs font-semibold text-ink-950"
              >
                Confirm — remove {flag.key}
              </button>
              <button type="button" onClick={() => setConfirming(false)} className="text-shell text-xs text-mist-500 hover:text-mist-100">
                Cancel
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
