import type { Environment, Service } from "../types";

export const ENV_LABEL: Record<Environment, string> = {
  test: "Test",
  qa: "QA",
  prod: "Prod",
};

/** A service as the dashboard shows it; a binding to a service the list does not hold yet still shows its id. */
export function serviceLabel(services: Service[], serviceId: string): { name: string; key: string } {
  const service = services.find((s) => s.id === serviceId);
  return service ? { name: service.name, key: service.key } : { name: serviceId, key: serviceId };
}
