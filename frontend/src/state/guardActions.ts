import { canEditFlags } from "../lib/permissions";
import type { Role } from "../types";
import type { StoreActions } from "./useStore";

const refuse = async (reason: string) => ({ ok: false, reason });

/**
 * The checks both modes share, before an action runs: the role (the API enforces the same, lib/permissions.ts mirrors
 * it for the UI) and input the form can catch without asking the server.
 */
export function guardActions(role: Role, actions: StoreActions): StoreActions {
  const editor = canEditFlags(role);
  const admin = role === "admin";
  return {
    toggleEnvironment: (flagKey, environment) => (editor ? actions.toggleEnvironment(flagKey, environment) : refuse("Viewers cannot change flag state.")),
    updateBinding: (flagKey, serviceId, patch) =>
      editor ? actions.updateBinding(flagKey, serviceId, patch) : refuse("Only Editors and Admins can change how a service reads a flag."),
    retireFlag: (flagKey) => (editor ? actions.retireFlag(flagKey) : refuse("Only Editors and Admins can retire flags.")),
    updateFlagMeta: (flagKey, patch) => (editor ? actions.updateFlagMeta(flagKey, patch) : refuse("Only Editors and Admins can edit flag details.")),
    createFlag: (input) => {
      if (!editor) return refuse("Only Editors and Admins can create flags.");
      if (!input.key.trim()) return refuse("Flag key is required.");
      return actions.createFlag(input);
    },
    registerService: (key, name) => {
      if (!admin) return refuse("Only Admins can register services and rotate their credentials.");
      if (!key.trim()) return refuse("Service key is required.");
      return actions.registerService(key.trim(), name.trim());
    },
    rotateCredential: (serviceId, revokePrevious) =>
      admin ? actions.rotateCredential(serviceId, revokePrevious) : refuse("Only Admins can register services and rotate their credentials."),
    setStaleThreshold: (days) => {
      if (!admin) return refuse("Only Admins can change the rules.");
      if (!Number.isInteger(days) || days < 1 || days > 365) return refuse("Enter a whole number of days from 1 to 365.");
      return actions.setStaleThreshold(days);
    },
  };
}
