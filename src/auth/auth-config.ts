import type { Role, SignedInUser } from "@shipscope/shared/types";

export type { SignedInUser };

// Sign-in to the dashboard and the management API through any OpenID Connect provider (Keycloak, Entra ID, Okta,
// Google, …): authorization code flow with PKCE, run by the API, which then keeps a server-side session. The browser
// never sees a token from the provider, only an HttpOnly session cookie. Settings come from the environment
// (.env.example); a missing or malformed one stops the API at start-up.

export interface AuthConfig {
  /** Public address of the dashboard, e.g. https://flags.example.com; the provider redirects back to <appUrl>/api/auth/callback. */
  appUrl: URL;
  issuer: string;
  /** Where the API reads the provider's metadata, when it reaches the provider at another address than the browser does. */
  discoveryUrl?: URL;
  clientId: string;
  clientSecret: string;
  scopes: string;
  /** Allows http:// for the provider: only for a local test provider (docker compose). */
  allowHttp: boolean;
  /** Claim holding the user's roles or groups; a dotted path such as "realm_access.roles" reaches into objects. */
  rolesClaim: string;
  adminRoles: string[];
  editorRoles: string[];
  /** When not empty, only users with one of these (or an editor or admin role) may sign in; else everyone the provider lets through is a viewer. */
  viewerRoles: string[];
  /**
   * When set, only members of this organization may sign in: for a provider shared by several organizations, such as
   * the Delivery Intelligence Suite identity service (Keycloak Organizations), where a role alone does not say which
   * organization's flags the user may see.
   */
  organization?: string;
  /** Claim listing the user's organizations (a dotted path; default "organization", as the suite identity service names it). */
  organizationClaim: string;
  sessionTtlMs: number;
}

const list = (raw: string | undefined, fallback: string[]) =>
  raw?.trim()
    ? raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : fallback;

function url(name: string, raw: string | undefined): URL {
  try {
    const value = new URL(raw!);
    if (value.protocol === "https:" || value.protocol === "http:") return value;
  } catch {
    // reported below
  }
  throw new Error(`${name} must be an http(s) URL, not "${raw ?? ""}".`);
}

/** The sign-in settings from the environment. Throws a readable error on a missing or malformed one. */
export function authConfig(env = process.env): AuthConfig {
  const missing = ["APP_URL", "OIDC_ISSUER", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET"].filter((name) => !env[name]?.trim());
  if (missing.length) throw new Error(`Sign-in is not configured: set ${missing.join(", ")} (see .env.example).`);
  const appUrl = url("APP_URL", env.APP_URL!.trim().replace(/\/+$/, ""));
  const issuer = url("OIDC_ISSUER", env.OIDC_ISSUER!.trim());
  const discoveryUrl = env.OIDC_DISCOVERY_URL?.trim() ? url("OIDC_DISCOVERY_URL", env.OIDC_DISCOVERY_URL.trim()) : undefined;
  const allowHttp = env.OIDC_ALLOW_HTTP === "true";
  for (const [name, value] of [
    ["OIDC_ISSUER", issuer],
    ["OIDC_DISCOVERY_URL", discoveryUrl],
  ] as const)
    if (value?.protocol === "http:" && !allowHttp) throw new Error(`${name} is http://: use https, or set OIDC_ALLOW_HTTP=true for a local test provider.`);
  const hours = Number(env.SESSION_TTL_HOURS?.trim() || 12);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24 * 30)
    throw new Error(`SESSION_TTL_HOURS must be a number of hours between 0 and 720, not "${env.SESSION_TTL_HOURS}".`);
  return {
    appUrl,
    issuer: env.OIDC_ISSUER!.trim(),
    discoveryUrl,
    clientId: env.OIDC_CLIENT_ID!.trim(),
    clientSecret: env.OIDC_CLIENT_SECRET!.trim(),
    scopes: env.OIDC_SCOPES?.trim() || "openid profile email",
    allowHttp,
    rolesClaim: env.OIDC_ROLES_CLAIM?.trim() || "roles",
    adminRoles: list(env.OIDC_ADMIN_ROLES, ["shipscope-admin"]),
    editorRoles: list(env.OIDC_EDITOR_ROLES, ["shipscope-editor"]),
    viewerRoles: list(env.OIDC_VIEWER_ROLES, []),
    ...(env.OIDC_ORGANIZATION?.trim() ? { organization: env.OIDC_ORGANIZATION.trim() } : {}),
    organizationClaim: env.OIDC_ORGANIZATION_CLAIM?.trim() || "organization",
    sessionTtlMs: hours * 60 * 60 * 1000,
  };
}

/** The values of a claim given by a dotted path; a single string counts as one value. */
function claimValues(claims: Record<string, unknown>, path: string): string[] {
  let value: unknown = claims;
  for (const part of path.split(".")) value = value && typeof value === "object" ? (value as Record<string, unknown>)[part] : undefined;
  if (typeof value === "string") return [value];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** Settings that work but are risky outside a local test setup; main.ts logs them at start-up. */
export function authWarnings(config: AuthConfig): string[] {
  return [
    ...(config.viewerRoles.length === 0
      ? [
          "OIDC_VIEWER_ROLES is empty: everyone the identity provider signs in can read flags, services and the audit log as a Viewer. Limit the client's users at the provider, or set OIDC_VIEWER_ROLES.",
        ]
      : []),
    ...(config.allowHttp && config.appUrl.protocol === "https:"
      ? ["OIDC_ALLOW_HTTP=true while APP_URL is https: talk to the identity provider over https too (OIDC_ALLOW_HTTP is for a local test provider)."]
      : []),
  ];
}

/**
 * The user's role from the provider's claims, or null when OIDC_VIEWER_ROLES is set and the user has none of the roles,
 * or when OIDC_ORGANIZATION is set and the user is not a member of it.
 */
export function roleFromClaims(
  claims: Record<string, unknown>,
  config: Pick<AuthConfig, "rolesClaim" | "adminRoles" | "editorRoles" | "viewerRoles"> & Partial<Pick<AuthConfig, "organization" | "organizationClaim">>,
): Role | null {
  if (config.organization && !claimValues(claims, config.organizationClaim ?? "organization").includes(config.organization)) return null;
  const roles = new Set(claimValues(claims, config.rolesClaim));
  if (config.adminRoles.some((r) => roles.has(r))) return "admin";
  if (config.editorRoles.some((r) => roles.has(r))) return "editor";
  if (config.viewerRoles.length === 0 || config.viewerRoles.some((r) => roles.has(r))) return "viewer";
  return null;
}

/** Why the provider's claims do not let a user in: not a member of OIDC_ORGANIZATION, or none of the roles. */
export type SignInRefusal = "not-member" | "no-role";

/** Why the claims keep the user out, or null when they let the user in (see roleFromClaims). */
export function refusalFromClaims(claims: Record<string, unknown>, config: Parameters<typeof roleFromClaims>[1]): SignInRefusal | null {
  if (config.organization && !claimValues(claims, config.organizationClaim ?? "organization").includes(config.organization)) return "not-member";
  return roleFromClaims(claims, config) ? null : "no-role";
}

/** Names the audit log uses for the system itself; a user who has one is named by email or subject instead. */
const RESERVED_USERNAMES = new Set(["break-glass", "shipscope", "api"]);

/** Who the claims describe; null when the user may not sign in (see roleFromClaims). */
export function userFromClaims(claims: Record<string, unknown>, config: Parameters<typeof roleFromClaims>[1]): SignedInUser | null {
  const role = roleFromClaims(claims, config);
  if (!role) return null;
  const str = (key: string) => (typeof claims[key] === "string" && (claims[key] as string).trim() ? (claims[key] as string).trim() : undefined);
  const email = str("email");
  const preferred = str("preferred_username");
  const username = [preferred, email, String(claims.sub)].find((name) => name && !RESERVED_USERNAMES.has(name.toLowerCase()))!;
  return { username, name: str("name") ?? username, email, role };
}
