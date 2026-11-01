import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Logger,
  NotFoundException,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request, Response } from "express";
import type { SignedInUser } from "./auth-config.js";
import { FlagsService } from "../flags/flags.service.js";
import { StrictLimit } from "../rate-limit.js";
import { BREAK_GLASS_SESSION_MS, BREAK_GLASS_USERNAME, breakGlassHash, verifyBreakGlassPassword } from "./break-glass.js";
import { CSRF_HEADER, CSRF_VALUE, CurrentUser, Public } from "./auth.guard.js";
import { OidcClient, type LoginChecks } from "./oidc.js";
import { cookie, readCookie, Sessions } from "./sessions.js";

const LOGIN_TTL_SECONDS = 10 * 60;

/** The body of a break-glass sign-in: the password and why it is needed now (kept in the audit log). */
function parseBreakGlass(input: unknown): { password: string; reason: string } {
  const body = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const unknown = Object.keys(body).filter((k) => k !== "password" && k !== "reason");
  if (unknown.length) throw new BadRequestException(`Unknown field: ${unknown[0]}.`);
  const password = typeof body.password === "string" ? body.password : "";
  // One line of plain text: it goes into the log, the audit log and a chat message.
  const reason = typeof body.reason === "string" ? body.reason.replace(/[\p{Cc}\p{Cf}]+/gu, " ").trim() : "";
  if (!password) throw new BadRequestException("The break-glass password is required.");
  if (reason.length < 10 || reason.length > 500) throw new BadRequestException("Say in 10 to 500 characters why break-glass access is needed.");
  return { password, reason };
}

/** User text in a Slack-compatible message: without <, > and & it cannot mention anyone or make a link. */
const chatText = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The checks kept in the login cookie, if it holds them; anything else counts as no sign-in in progress. */
function parseLoginChecks(raw: string | undefined): LoginChecks | null {
  try {
    const value = JSON.parse(raw ?? "") as Record<string, unknown>;
    const { state, nonce, verifier } = value;
    return typeof state === "string" && typeof nonce === "string" && typeof verifier === "string" ? { state, nonce, verifier } : null;
  } catch {
    return null;
  }
}

/**
 * Sign-in through the OIDC provider. The dashboard sends the browser to /api/auth/login; the provider sends it back to
 * /api/auth/callback, which starts a session and returns to the dashboard (with ?login_error=… when sign-in failed).
 */
@Controller()
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  /** Read once at start-up: changing BREAK_GLASS_PASSWORD_HASH needs a restart. */
  private readonly breakGlass = breakGlassHash();

  constructor(
    private readonly oidc: OidcClient,
    private readonly sessions: Sessions,
    private readonly flags: FlagsService,
  ) {}

  private loginCookie(value: string, maxAgeSeconds: number) {
    return cookie(this.sessions.names.login, value, { maxAgeSeconds, secure: this.sessions.secure });
  }

  private requireCsrfHeader(req: Request) {
    if (req.headers[CSRF_HEADER] !== CSRF_VALUE) throw new ForbiddenException(`The request must carry the header "X-Requested-With: ${CSRF_VALUE}".`);
  }

  private backToApp(res: Response, error?: string) {
    const target = new URL(this.oidc.config.appUrl.href);
    if (error) target.searchParams.set("login_error", error);
    res.redirect(302, target.href);
  }

  @Public()
  @Get("auth/login")
  async login(@Res() res: Response) {
    let started: Awaited<ReturnType<OidcClient["startLogin"]>>;
    try {
      started = await this.oidc.startLogin();
    } catch {
      return this.backToApp(res, "unavailable");
    }
    res.append("Set-Cookie", this.loginCookie(JSON.stringify(started.checks), LOGIN_TTL_SECONDS));
    res.redirect(302, started.url.href);
  }

  @Public()
  @Get("auth/callback")
  async callback(@Req() req: Request, @Res() res: Response) {
    res.append("Set-Cookie", this.loginCookie("", 0));
    const checks = parseLoginChecks(readCookie(req.headers.cookie, this.sessions.names.login));
    if (!checks) return this.backToApp(res, "expired");
    // The registered redirect URI with the parameters the provider sent; behind a proxy the request's own host may differ.
    const callbackUrl = new URL(this.oidc.redirectUri);
    callbackUrl.search = new URL(req.originalUrl, callbackUrl).search;
    if (callbackUrl.searchParams.has("error")) return this.backToApp(res, "denied");
    try {
      const { user, idToken } = await this.oidc.finishLogin(callbackUrl, checks);
      if (!user) return this.backToApp(res, "no-role");
      const config = this.oidc.config;
      const token = await this.sessions.create(user, idToken, config.sessionTtlMs);
      res.append("Set-Cookie", this.sessions.sessionCookie(token, Math.floor(config.sessionTtlMs / 1000)));
      this.logger.log(`${user.username} signed in as ${user.role}`);
      this.backToApp(res);
    } catch (err) {
      this.logger.warn(`Sign-in failed: ${(err as Error).message}`);
      this.backToApp(res, "failed");
    }
  }

  /** What the sign-in page may offer besides the identity provider. */
  @Public()
  @Get("auth/options")
  options() {
    return { breakGlass: this.breakGlass !== null };
  }

  /**
   * Break-glass sign-in (PRD FR-002), for when the identity provider is down: the password from the secrets vault
   * starts a one-hour Admin session. Each use and each failed attempt goes to the audit log and to the webhook.
   */
  @Public()
  @Post("auth/break-glass")
  @HttpCode(200)
  // Attempts per client address: enough for a person, too few to guess or to load the server with scrypt.
  @StrictLimit(5, 15 * 60_000)
  async breakGlassLogin(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: unknown) {
    if (!this.breakGlass) throw new NotFoundException("Break-glass access is not set up on this server.");
    this.requireCsrfHeader(req);
    const { password, reason } = parseBreakGlass(body);
    const from = `from ${req.ip ?? "an unknown address"}`;
    if (!(await verifyBreakGlassPassword(password, this.breakGlass))) {
      this.logger.warn(`Failed break-glass sign-in ${from}`);
      await this.flags.recordSecurityEvent(
        { actor: BREAK_GLASS_USERNAME, action: "break-glass-failed", note: `wrong password ${from}` },
        `:warning: Failed break-glass sign-in to ShipScope Flags ${chatText(from)}.`,
      );
      throw new UnauthorizedException("Wrong break-glass password. The attempt was logged.");
    }
    const user: SignedInUser = { username: BREAK_GLASS_USERNAME, name: "Break-glass admin", role: "admin", breakGlass: true };
    const token = await this.sessions.create(user, undefined, BREAK_GLASS_SESSION_MS);
    res.append("Set-Cookie", this.sessions.sessionCookie(token, BREAK_GLASS_SESSION_MS / 1000));
    this.logger.warn(`Break-glass sign-in ${from}: ${reason}`);
    await this.flags.recordSecurityEvent(
      { actor: BREAK_GLASS_USERNAME, action: "break-glass-login", note: `${reason} (${from})` },
      `:rotating_light: Break-glass sign-in to ShipScope Flags ${chatText(from)}. Reason: ${chatText(reason)}`,
    );
    return user;
  }

  /**
   * Ends the session; the answer names the provider's sign-out page, where the dashboard sends the browser next.
   * Public (an expired session can still sign out), so it checks the CSRF header itself.
   */
  @Public()
  @Post("auth/logout")
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.requireCsrfHeader(req);
    const idToken = await this.sessions.end(this.sessions.tokenOf(req.headers.cookie));
    res.append("Set-Cookie", this.sessions.sessionCookie("", 0));
    return { logoutUrl: await this.oidc.logoutUrl(idToken) };
  }

  /** The signed-in user (401 when nobody is). */
  @Get("me")
  me(@CurrentUser() user: SignedInUser) {
    return user;
  }
}
