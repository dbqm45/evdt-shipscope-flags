import { Controller, ForbiddenException, Get, Headers, Query } from "@nestjs/common";
import { Public } from "../auth/auth.guard.js";
import { SdkRoute } from "../rate-limit.js";
import { parseEnvironment } from "./flags.input.js";
import { FlagsService } from "./flags.service.js";
import { identifySdkCaller } from "./sdk-auth.js";

/** Consumer API: what services integrate against (docs/sdk-api.md). */
@Controller()
export class SdkController {
  constructor(private readonly flags: FlagsService) {}

  /**
   * GET /api/v1/sdk/flags?env=prod  ->  { env, flags: { "flag-key": true, ... } }.
   * A service sends "Authorization: Bearer <its credential>" and gets the flags assigned to it; each read is its
   * check-in. The shared SDK_TOKEN (deprecated) reads every flag, or one service's with ?service=. /api/sdk/flags is
   * the same endpoint under its pre-v1 path.
   */
  @Get(["v1/sdk/flags", "sdk/flags"])
  @SdkRoute()
  @Public()
  async flagsFor(@Query("env") env: string | undefined, @Query("service") service: string | undefined, @Headers("authorization") auth: string | undefined) {
    const caller = await identifySdkCaller(auth, (tokenHash) => this.flags.serviceByToken(tokenHash));
    const environment = parseEnvironment(env);
    if ("shared" in caller) return { env: environment, flags: await this.flags.evaluate(environment, service) };
    const own = caller.service;
    if (service !== undefined && service !== own.key)
      throw new ForbiddenException(`This credential belongs to "${own.key}"; it cannot read the flags of "${service}".`);
    const flags = await this.flags.evaluate(environment, own.key);
    await this.flags.recordCheckIn(own.id, environment);
    return { env: environment, flags };
  }
}
