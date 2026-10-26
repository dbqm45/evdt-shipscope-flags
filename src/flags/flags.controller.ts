import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Headers, HttpCode, Param, Patch, Post, Put, Query } from "@nestjs/common";
import {
  parseActor,
  parseBindingPatch,
  parseCreateFlag,
  parseFlagPatch,
  parseNotificationSettings,
  parseRegisterService,
  parseRotateCredential,
} from "./flags.input.js";
import { SdkRoute } from "../rate-limit.js";
import { FlagsService, isEnvironment } from "./flags.service.js";
import { identifySdkCaller } from "./sdk-auth.js";

function parseEnv(value: string | undefined) {
  if (!value || !isEnvironment(value)) throw new BadRequestException("env must be one of: test, qa, prod.");
  return value;
}

@Controller()
export class FlagsController {
  constructor(private readonly flags: FlagsService) {}

  // --- Management API (used by the ShipScope Flags UI) ---

  @Get("flags")
  list() {
    return this.flags.listFlags();
  }

  @Post("flags")
  createFlag(@Body() body: unknown) {
    return this.flags.createFlag(parseCreateFlag(body), parseActor(body));
  }

  @Patch("flags/:key")
  updateFlag(@Param("key") key: string, @Body() body: unknown) {
    return this.flags.updateFlag(key, parseFlagPatch(body), parseActor(body));
  }

  @Patch("flags/:key/services/:serviceId")
  updateBinding(@Param("key") key: string, @Param("serviceId") serviceId: string, @Body() body: unknown) {
    return this.flags.updateBinding(key, serviceId, parseBindingPatch(body), parseActor(body));
  }

  /** 409 with every reason when removing the flag could change a service's behaviour. */
  @Delete("flags/:key")
  @HttpCode(200)
  async retireFlag(@Param("key") key: string, @Body() body: unknown) {
    await this.flags.retireFlag(key, parseActor(body));
    return { ok: true };
  }

  @Get("services")
  services() {
    return this.flags.listServices();
  }

  /** 201 with the service and its credential; the credential is shown only in this response. */
  @Post("services")
  registerService(@Body() body: unknown) {
    return this.flags.registerService(parseRegisterService(body), parseActor(body));
  }

  /** New credential (shown once); the old one keeps working for 24 h unless the body says "revokePrevious": true. */
  @Post("services/:id/credential")
  @HttpCode(200)
  rotateCredential(@Param("id") id: string, @Body() body: unknown) {
    return this.flags.rotateCredential(id, parseRotateCredential(body).revokePrevious, parseActor(body));
  }

  @Get("audit-log")
  auditLog() {
    return this.flags.listAuditLog();
  }

  @Patch("flags/:key/environments/:env")
  async setEnvironment(@Param("key") key: string, @Param("env") env: string, @Body() body: { enabled?: boolean; actor?: string }) {
    if (typeof body?.enabled !== "boolean") throw new BadRequestException('Body must contain boolean "enabled".');
    const flag = await this.flags.setEnvironment(key, parseEnv(env), body.enabled, body.actor ?? "api");
    return { ok: true, flag };
  }

  @Get("settings/notifications")
  getNotifications() {
    return this.flags.getNotifications();
  }

  @Put("settings/notifications")
  setNotifications(@Body() body: unknown) {
    return this.flags.setNotifications(parseNotificationSettings(body));
  }

  @Post("settings/notifications/test")
  testNotification() {
    return this.flags.testNotification();
  }

  // --- Consumer API (used by your services to read flag state) ---

  /**
   * GET /api/v1/sdk/flags?env=prod  ->  { env, flags: { "flag-key": true, ... } }, the contract in docs/sdk-api.md.
   * A service sends "Authorization: Bearer <its credential>" and gets the flags assigned to it; each read is its
   * check-in. The shared SDK_TOKEN (deprecated) reads every flag, or one service's with ?service=. /api/sdk/flags is
   * the same endpoint under its pre-v1 path.
   */
  @Get(["v1/sdk/flags", "sdk/flags"])
  @SdkRoute()
  async sdkFlags(@Query("env") env: string | undefined, @Query("service") service: string | undefined, @Headers("authorization") auth: string | undefined) {
    const caller = await identifySdkCaller(auth, (tokenHash) => this.flags.serviceByToken(tokenHash));
    const environment = parseEnv(env);
    if ("shared" in caller) return { env: environment, flags: await this.flags.evaluate(environment, service) };
    const own = caller.service;
    if (service !== undefined && service !== own.key)
      throw new ForbiddenException(`This credential belongs to "${own.key}"; it cannot read the flags of "${service}".`);
    const flags = await this.flags.evaluate(environment, own.key);
    await this.flags.recordCheckIn(own.id, environment);
    return { env: environment, flags };
  }
}
