import type { Role } from "../types";

export function canEditFlags(role: Role): boolean {
  return role === "editor" || role === "admin";
}

export const ROLE_LABEL: Record<Role, string> = {
  viewer: "Viewer",
  editor: "Editor",
  admin: "Admin",
};
