import clsx from "clsx";
import { driftRisks } from "../../lib/businessLogic";
import { groupByService } from "../../lib/matrix";
import { useStore } from "../../state/useStore";
import { ENVIRONMENTS, type Flag } from "../../types";
import { Badge } from "../common/Badge";
import { IconAlertTriangle } from "../icons";

const TH = "px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-mist-500";
const READ_MODE = { runtime: "runtime", "build-time": "build-time", both: "build-time + runtime" } as const;

/** The flags grouped by the service that reads them (PRD FR-009); a cell is marked when that service may disagree. */
export function ServiceMatrix({ flags, onSelect }: { flags: Flag[]; onSelect: (flagKey: string) => void }) {
  const { services } = useStore();
  const groups = groupByService(flags, services);

  if (groups.length === 0)
    return <p className="rounded-3xl border border-ink-600 bg-ink-850 px-4 py-10 text-center text-sm text-mist-500">No flags match your filters.</p>;

  return (
    <div className="space-y-4">
      {groups.map(({ service, rows }) => (
        <section
          key={service?.id ?? "unassigned"}
          aria-label={service?.key ?? "Not read by any service"}
          className="overflow-x-auto rounded-3xl border border-ink-600 bg-ink-850"
        >
          <header className="flex items-baseline justify-between gap-3 border-b border-ink-600 px-4 py-3">
            <h2 className="text-shell text-sm font-semibold text-mist-100">{service?.key ?? "Not read by any service"}</h2>
            <span className="text-xs text-mist-500">
              {rows.length} {rows.length === 1 ? "flag" : "flags"}
            </span>
          </header>
          {/* Fixed column widths, so the tables of all services line up. */}
          <table className="w-full min-w-[640px] table-fixed border-collapse text-sm">
            <colgroup>
              <col className="w-[40%]" />
              <col className="w-[24%]" />
              {ENVIRONMENTS.map((e) => (
                <col key={e} className="w-[12%]" />
              ))}
            </colgroup>
            <thead>
              <tr className="border-b border-ink-700/60">
                <th className={TH}>Flag</th>
                <th className={TH}>Reads</th>
                {ENVIRONMENTS.map((e) => (
                  <th key={e} className={TH}>
                    {e}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-700/60">
              {rows.map(({ flag, binding }) => {
                const drift = service ? driftRisks(flag, services).filter((r) => r.serviceId === service.id) : [];
                return (
                  <tr key={flag.id} onClick={() => onSelect(flag.key)} className="cursor-pointer transition-colors hover:bg-ink-800/50">
                    <td className="text-shell truncate px-4 py-2.5 font-medium text-mist-100">{flag.key}</td>
                    <td className="px-4 py-2.5">
                      {binding ? (
                        <span className="text-xs text-mist-500">{binding.removedFromCode ? "removed from code" : READ_MODE[binding.readMode]}</span>
                      ) : (
                        <span className="text-xs text-mist-700">—</span>
                      )}
                    </td>
                    {ENVIRONMENTS.map((e) => {
                      const on = flag.environments[e].enabled;
                      const drifting = drift.some((r) => r.environment === e);
                      return (
                        <td key={e} className="px-4 py-2.5">
                          <span className={clsx("text-shell inline-flex items-center gap-1.5 text-xs font-semibold", on ? "text-signal-on" : "text-mist-700")}>
                            <span className={clsx("h-1.5 w-1.5 rounded-full", on ? "bg-signal-on" : "bg-signal-off")} />
                            {on ? "ON" : "OFF"}
                            {drifting && (
                              <Badge tone="critical" title={`${service?.key} may still use a different value in ${e}`}>
                                <IconAlertTriangle width={10} height={10} />
                                drift
                              </Badge>
                            )}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
