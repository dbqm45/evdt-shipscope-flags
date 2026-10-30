import { Controller, Get, HttpCode, Logger, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import type { SignedInUser } from "./auth-config.js";
import { CurrentUser, Public } from "./auth.guard.js";
import { OidcClient, type LoginChecks } from "./oidc.js";
import { cookie, LOGIN_COOKIE, readCookie, SESSION_COOKIE, Sessions } from "./sessions.js";

const LOGIN_TTL_SECONDS = 10 * 60;

/**
 * Sign-in through the OIDC provider. The dashboard sends the browser to /api/auth/login; the provider sends it back to
 * /api/auth/callback, which starts a session and returns to the dashboard (with ?login_error=… when sign-in failed).
 */
@Controller()
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly oidc: OidcClient,
    private readonly sessions: Sessions,
  ) {}

  private get secure() {
    return this.oidc.config.appUrl.protocol === "https:";
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
    res.append(
      "Set-Cookie",
      cookie(LOGIN_COOKIE, JSON.stringify(started.checks), { path: "/api/auth", maxAgeSeconds: LOGIN_TTL_SECONDS, secure: this.secure }),
    );
    res.redirect(302, started.url.href);
  }

  @Public()
  @Get("auth/callback")
  async callback(@Req() req: Request, @Res() res: Response) {
    res.append("Set-Cookie", cookie(LOGIN_COOKIE, "", { path: "/api/auth", maxAgeSeconds: 0, secure: this.secure }));
    let checks: LoginChecks;
    try {
      checks = JSON.parse(readCookie(req.headers.cookie, LOGIN_COOKIE) ?? "") as LoginChecks;
    } catch {
      return this.backToApp(res, "expired");
    }
    // The registered redirect URI with the parameters the provider sent; behind a proxy the request's own host may differ.
    const callbackUrl = new URL(this.oidc.redirectUri);
    callbackUrl.search = new URL(req.originalUrl, callbackUrl).search;
    if (callbackUrl.searchParams.has("error")) return this.backToApp(res, "denied");
    try {
      const { user, idToken } = await this.oidc.finishLogin(callbackUrl, checks);
      if (!user) return this.backToApp(res, "no-role");
      const config = this.oidc.config;
      const token = await this.sessions.create(user, idToken, config.sessionTtlMs);
      res.append("Set-Cookie", cookie(SESSION_COOKIE, token, { path: "/api", maxAgeSeconds: Math.floor(config.sessionTtlMs / 1000), secure: this.secure }));
      this.logger.log(`${user.username} signed in as ${user.role}`);
      this.backToApp(res);
    } catch (err) {
      this.logger.warn(`Sign-in failed: ${(err as Error).message}`);
      this.backToApp(res, "failed");
    }
  }

  /** Ends the session; the answer names the provider's sign-out page, where the dashboard sends the browser next. */
  @Public()
  @Post("auth/logout")
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const idToken = await this.sessions.end(readCookie(req.headers.cookie, SESSION_COOKIE));
    res.append("Set-Cookie", cookie(SESSION_COOKIE, "", { path: "/api", maxAgeSeconds: 0, secure: this.secure }));
    return { logoutUrl: await this.oidc.logoutUrl(idToken) };
  }

  /** The signed-in user (401 when nobody is). */
  @Get("me")
  me(@CurrentUser() user: SignedInUser) {
    return user;
  }
}
