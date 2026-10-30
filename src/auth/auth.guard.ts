import {
  createParamDecorator,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Role } from "@shipscope/shared/types";
import type { Request } from "express";
import type { SignedInUser } from "./auth-config.js";
import { readCookie, SESSION_COOKIE, Sessions } from "./sessions.js";

// Every route needs a signed-in user unless marked @Public() (health, the consumer endpoint, the sign-in routes).
// Reading needs any role; a change needs the role named by @RequireRole() on the route, else Admin. A change must
// also carry "X-Requested-With: shipscope": a header no other site can make a browser send without a CORS preflight
// (which this API never allows), so a forged cross-site request fails even though the session cookie goes along.

const PUBLIC = "shipscope:public";
const ROLE = "shipscope:role";
const RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2 };

export const CSRF_HEADER = "x-requested-with";
export const CSRF_VALUE = "shipscope";

/** A route anyone may call: it authenticates its callers in its own way, or not at all. */
export const Public = () => SetMetadata(PUBLIC, true);

/** The lowest role allowed to call a route that changes something (default Admin). */
export const RequireRole = (role: Role) => SetMetadata(ROLE, role);

export const hasRole = (user: SignedInUser, role: Role) => RANK[user.role] >= RANK[role];

type AuthedRequest = Request & { user?: SignedInUser };

/** The signed-in user of the request (set by AuthGuard). */
export const CurrentUser = createParamDecorator((_: unknown, context: ExecutionContext) => context.switchToHttp().getRequest<AuthedRequest>().user!);

/** Who the audit log names for a change made by this request. */
export const Actor = createParamDecorator((_: unknown, context: ExecutionContext) => context.switchToHttp().getRequest<AuthedRequest>().user!.username);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: Sessions,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, targets)) return true;
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const user = await this.sessions.find(readCookie(req.headers.cookie, SESSION_COOKIE));
    if (!user) throw new UnauthorizedException("Sign in first (GET /api/auth/login).");
    const reading = req.method === "GET" || req.method === "HEAD";
    if (!reading && req.headers[CSRF_HEADER] !== CSRF_VALUE) throw new ForbiddenException(`A change must carry the header "X-Requested-With: ${CSRF_VALUE}".`);
    const needed = reading ? "viewer" : (this.reflector.getAllAndOverride<Role>(ROLE, targets) ?? "admin");
    if (!hasRole(user, needed)) throw new ForbiddenException(`This needs the ${needed} role; you are signed in as ${user.role}.`);
    req.user = user;
    return true;
  }
}
