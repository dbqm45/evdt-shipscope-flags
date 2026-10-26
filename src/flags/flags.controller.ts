import { BadRequestException, Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Put, Query } from "@nestjs/common";
import { parseActor, parseBindingPatch, parseCreateFlag, parseFlagPatch, parseNotificationSettings } from "./flags.input.js";
import { FlagsService, isEnvironment } from "./flags.service.js";
import { checkSdkToken } from "./sdk-auth.js";

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
   * GET /api/sdk/flags?env=prod&service=checkout-api  ->  { env, flags: { "flag-key": true, ... } }
   * Callers must send "Authorization: Bearer <SDK_TOKEN>"; without SDK_TOKEN on the server it answers 503 (sdk-auth.ts).
   */
  @Get("sdk/flags")
  async sdkFlags(@Query("env") env: string | undefined, @Query("service") service: string | undefined, @Headers("authorization") auth: string | undefined) {
    checkSdkToken(auth);
    const environment = parseEnv(env);
    return { env: environment, flags: await this.flags.evaluate(environment, service) };
  }
}
