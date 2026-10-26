import { BadRequestException, Body, Controller, Get, Headers, Param, Patch, Post, Put, Query, UnauthorizedException } from "@nestjs/common";
import { FlagsService, isEnvironment } from "./flags.service.js";

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
    await this.flags.setEnvironment(key, parseEnv(env), body.enabled, body.actor ?? "api");
    return { ok: true };
  }

  @Get("settings/notifications")
  getNotifications() {
    return this.flags.getNotifications();
  }

  @Put("settings/notifications")
  setNotifications(@Body() body: { enabled?: boolean; webhookUrl?: string }) {
    return this.flags.setNotifications({ enabled: body?.enabled, webhookUrl: body?.webhookUrl });
  }

  @Post("settings/notifications/test")
  testNotification() {
    return this.flags.testNotification();
  }

  // --- Consumer API (used by your services to read flag state) ---

  /**
   * GET /api/sdk/flags?env=prod&service=checkout-api  ->  { env, flags: { "flag-key": true, ... } }
   * If SDK_TOKEN is set, callers must send "Authorization: Bearer <SDK_TOKEN>".
   */
  @Get("sdk/flags")
  async sdkFlags(@Query("env") env: string | undefined, @Query("service") service: string | undefined, @Headers("authorization") auth: string | undefined) {
    const token = process.env.SDK_TOKEN;
    if (token && auth !== `Bearer ${token}`) throw new UnauthorizedException("Missing or invalid SDK token.");
    const environment = parseEnv(env);
    return { env: environment, flags: await this.flags.evaluate(environment, service) };
  }
}
