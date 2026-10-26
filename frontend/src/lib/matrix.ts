import type { Flag, FlagServiceBinding, Service } from "../types";

export interface ServiceGroup {
  /** Undefined for the flags no service reads. */
  service?: Service;
  rows: Array<{ flag: Flag; binding?: FlagServiceBinding }>;
}

/**
 * The flags grouped by the service that reads them (PRD FR-009), services in their registration order and flags in
 * the order given. A flag read by several services appears under each; flags no service reads come last.
 */
export function groupByService(flags: Flag[], services: Service[]): ServiceGroup[] {
  const groups: ServiceGroup[] = services.map((service) => ({
    service,
    rows: flags.flatMap((flag) => {
      const binding = flag.services.find((b) => b.serviceId === service.id);
      return binding ? [{ flag, binding }] : [];
    }),
  }));
  const unassigned = flags.filter((f) => f.services.length === 0).map((flag) => ({ flag }));
  return [...groups.filter((g) => g.rows.length > 0), ...(unassigned.length ? [{ rows: unassigned }] : [])];
}
