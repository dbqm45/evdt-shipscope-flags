import { useState } from "react";
import clsx from "clsx";
import { useStore } from "../../state/useStore";
import { parseTags } from "../../lib/tags";
import { Modal } from "../common/Modal";
import type { FlagType } from "../../types";

const INPUT =
  "text-shell mt-1.5 w-full rounded-xl border border-ink-500 bg-ink-900 px-3 py-2 text-sm text-mist-100 outline-none placeholder:text-mist-700 focus:border-accent/60 focus:ring-1 focus:ring-accent/30";
const LABEL = "text-shell text-[10px] font-semibold uppercase tracking-widest text-mist-700";

export function CreateFlagModal({ onClose, onCreated }: { onClose: () => void; onCreated: (flagKey: string) => void }) {
  const { services, flags, createFlag, currentUser } = useStore();
  const [key, setKey] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<FlagType>("release");
  const [dependsOn, setDependsOn] = useState("");
  const [owner, setOwner] = useState(currentUser);
  const [reviewBy, setReviewBy] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  function toggleService(id: string) {
    setServiceIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    const result = await createFlag({
      key: key.trim(),
      description: description.trim(),
      type,
      serviceIds,
      dependsOn,
      owner: owner.trim(),
      reviewBy: reviewBy || undefined,
      tags: parseTags(tagsText),
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.reason ?? "Could not create flag.");
      return;
    }
    onCreated(key.trim());
  }

  return (
    <Modal title="Create flag" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="text-shell text-[10px] font-semibold uppercase tracking-widest text-mist-700">Key</label>
          <input
            value={key}
            onChange={(e) => setKey(e.target.value.replace(/[^A-Za-z0-9._-]/g, ""))}
            placeholder="chargerBulkEditEnabled"
            className="text-shell mt-1.5 w-full rounded-xl border border-ink-500 bg-ink-900 px-3 py-2 text-sm text-mist-100 outline-none placeholder:text-mist-700 focus:border-accent/60 focus:ring-1 focus:ring-accent/30"
          />
        </div>

        <div>
          <label className="text-shell text-[10px] font-semibold uppercase tracking-widest text-mist-700">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="What does this flag gate?"
            className="mt-1.5 w-full resize-none rounded-xl border border-ink-500 bg-ink-900 px-3 py-2 text-sm text-mist-100 outline-none placeholder:text-mist-700 focus:border-accent/60 focus:ring-1 focus:ring-accent/30"
          />
        </div>

        <div>
          <label className="text-shell text-[10px] font-semibold uppercase tracking-widest text-mist-700">Type</label>
          <div className="mt-1.5 flex gap-2">
            {(["feature", "release"] as FlagType[]).map((t) => (
              <button
                key={t}
                onClick={() => setType(t)}
                className={clsx(
                  "text-shell flex-1 rounded-xl border px-3 py-2 text-xs font-medium uppercase tracking-wide transition-colors",
                  type === t ? "border-accent bg-accent text-ink-950" : "border-ink-500 text-mist-500 hover:text-mist-300",
                )}
              >
                {t}
              </button>
            ))}
          </div>
          {type === "release" && (
            <p className="mt-1.5 text-[11px] text-mist-700">Release flags left fully on for 30+ days are auto-flagged as candidates for removal.</p>
          )}
        </div>

        <div>
          <label className="text-shell text-[10px] font-semibold uppercase tracking-widest text-mist-700">Requires flag (optional)</label>
          <select
            value={dependsOn}
            onChange={(e) => setDependsOn(e.target.value)}
            className="text-shell mt-1.5 w-full rounded-xl border border-ink-500 bg-ink-900 px-3 py-2 text-sm text-mist-100 outline-none focus:border-accent/60"
          >
            <option value="">None</option>
            {flags.map((f) => (
              <option key={f.id} value={f.key}>
                {f.key}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-[11px] text-mist-700">
            Use it for deploy order, e.g. a frontend flag that requires its backend flag. It cannot be enabled in an environment until that flag is on there.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LABEL}>Owner</label>
            <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="m.chen or team name" className={INPUT} />
          </div>
          <div>
            <label className={LABEL}>Review by (optional)</label>
            <input type="date" value={reviewBy} onChange={(e) => setReviewBy(e.target.value)} className={INPUT} />
          </div>
        </div>
        <div>
          <label className={LABEL}>Tags (comma separated)</label>
          <input value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="checkout, orders" className={INPUT} />
        </div>

        <div>
          <label className="text-shell text-[10px] font-semibold uppercase tracking-widest text-mist-700">Assign to services</label>
          <div className="mt-1.5 max-h-36 space-y-1 overflow-y-auto rounded-xl border border-ink-500 bg-ink-900 p-1.5">
            {services.map((s) => (
              <label key={s.id} className="flex cursor-pointer items-center gap-2.5 rounded px-2 py-1.5 hover:bg-ink-800">
                <input type="checkbox" checked={serviceIds.includes(s.id)} onChange={() => toggleService(s.id)} className="h-3.5 w-3.5 accent-accent" />
                <span className="text-shell text-xs text-mist-300">{s.key}</span>
              </label>
            ))}
          </div>
        </div>

        {error && <p className="text-xs text-signal-critical">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="text-shell rounded-xl px-3.5 py-2 text-xs font-medium text-mist-500 hover:text-mist-200">
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={!key.trim() || busy}
            className="text-shell rounded-xl bg-accent px-3.5 py-2 text-xs font-semibold text-ink-950 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Create flag
          </button>
        </div>
      </div>
    </Modal>
  );
}
