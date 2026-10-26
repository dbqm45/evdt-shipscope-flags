import clsx from "clsx";
import { ENVIRONMENTS, type Environment, type Flag, type FlagServiceBinding, type ReadMode } from "../../types";
import { driftRisks } from "../../lib/businessLogic";
import { serviceLabel } from "../../lib/labels";
import { useStore } from "../../state/store";
import { Badge } from "../common/Badge";
import { IconAlertTriangle } from "../icons";

const READ_MODE_LABEL: Record<ReadMode, string> = {
  runtime: "runtime only",
  "build-time": "build-time only",
  both: "build-time + runtime",
};

const CYCLE: Array<boolean | undefined> = [undefined, true, false];

function nextValue(value: boolean | undefined): boolean | undefined {
  return CYCLE[(CYCLE.indexOf(value) + 1) % CYCLE.length];
}

export function BindingCard({
  flag,
  binding,
  editable,
  onChange,
}: {
  flag: Flag;
  binding: FlagServiceBinding;
  editable: boolean;
  onChange: (patch: Partial<FlagServiceBinding>) => void;
}) {
  const { services } = useStore();
  const svc = serviceLabel(services, binding.serviceId);
  const drift = driftRisks(flag, services).filter((r) => r.serviceId === binding.serviceId);
  const carriesConstant = binding.readMode !== "runtime" && !binding.removedFromCode;

  function setEnv(env: Environment) {
    const next = { ...binding.buildTimeValues };
    const value = nextValue(next[env]);
    if (value === undefined) delete next[env];
    else next[env] = value;
    onChange({ buildTimeValues: next });
  }

  return (
    <div className="rounded-xl border border-ink-600 bg-ink-850/60 px-3.5 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-shell truncate text-sm text-mist-100">{svc.name}</p>
          <p className="text-shell text-[11px] text-mist-700">{svc.key}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {drift.length > 0 && (
            <Badge tone="critical" title={`May disagree with the flag in ${drift.map((r) => r.environment).join(", ")}`}>
              <IconAlertTriangle width={10} height={10} />
              drift
            </Badge>
          )}
          {binding.removedFromCode && <Badge tone="on">removed from code</Badge>}
        </div>
      </div>

      {!binding.removedFromCode && (
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-[11px] text-mist-500">Reads flag from</span>
          <select
            value={binding.readMode}
            disabled={!editable}
            onChange={(e) => onChange({ readMode: e.target.value as ReadMode })}
            className="text-shell rounded-lg border border-ink-500 bg-ink-900 px-2 py-1 text-[11px] text-mist-100 outline-none focus:border-accent/60 disabled:opacity-50"
          >
            {(Object.keys(READ_MODE_LABEL) as ReadMode[]).map((m) => (
              <option key={m} value={m}>
                {READ_MODE_LABEL[m]}
              </option>
            ))}
          </select>
        </div>
      )}

      {carriesConstant && (
        <div className="mt-3">
          <p className="text-[11px] text-mist-500">
            Value in this service's code. Runtime wins while the flag exists; if the flag is removed the service falls back to this.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {ENVIRONMENTS.map((env) => {
              const value = binding.buildTimeValues?.[env];
              const runtime = flag.environments[env].enabled;
              const mismatch = value !== undefined && value !== runtime;
              return (
                <button
                  key={env}
                  type="button"
                  disabled={!editable}
                  onClick={() => setEnv(env)}
                  title={
                    value === undefined
                      ? "Not recorded — click to set"
                      : mismatch
                        ? `Runtime is ${runtime ? "ON" : "OFF"}; removing the flag would switch this service to ${value ? "ON" : "OFF"}`
                        : "Matches runtime"
                  }
                  className={clsx(
                    "text-shell rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:cursor-default",
                    value === undefined && "border-dashed border-ink-500 text-mist-500",
                    value !== undefined && !mismatch && "border-ink-500 text-mist-300",
                    mismatch && "border-signal-warn/50 bg-signal-warn-dim/30 text-signal-warn",
                  )}
                >
                  {env} {value === undefined ? "?" : value ? "ON" : "OFF"}
                  {mismatch && " ≠ runtime"}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <label className={clsx("mt-3 flex items-center gap-2 text-[11px] text-mist-500", editable ? "cursor-pointer" : "opacity-60")}>
        <input
          type="checkbox"
          checked={!!binding.removedFromCode}
          disabled={!editable}
          onChange={(e) => onChange({ removedFromCode: e.target.checked })}
          className="h-3.5 w-3.5 accent-accent"
        />
        Flag has been removed from this service's code
      </label>
    </div>
  );
}
