import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { parseActor, parseBindingPatch, parseCreateFlag, parseEnvironment, parseEnvironmentChange, parseFlagPatch } from "./flags.input.js";
import { FlagsService } from "./flags.service.js";

/** Management API for flags (used by the dashboard). */
@Controller("flags")
export class FlagsController {
  constructor(private readonly flags: FlagsService) {}

  @Get()
  list() {
    return this.flags.listFlags();
  }

  @Post()
  createFlag(@Body() body: unknown) {
    return this.flags.createFlag(parseCreateFlag(body), parseActor(body));
  }

  @Patch(":key")
  updateFlag(@Param("key") key: string, @Body() body: unknown) {
    return this.flags.updateFlag(key, parseFlagPatch(body), parseActor(body));
  }

  /** 409 with every reason when removing the flag could change a service's behaviour. */
  @Delete(":key")
  @HttpCode(200)
  async retireFlag(@Param("key") key: string, @Body() body: unknown) {
    await this.flags.retireFlag(key, parseActor(body));
    return { ok: true };
  }

  /** 409 when the promotion order or a dependency blocks the change; the attempt is logged either way. */
  @Patch(":key/environments/:env")
  async setEnvironment(@Param("key") key: string, @Param("env") env: string, @Body() body: unknown) {
    const enabled = parseEnvironmentChange(body);
    const flag = await this.flags.setEnvironment(key, parseEnvironment(env), enabled, parseActor(body));
    return { ok: true, flag };
  }

  @Patch(":key/services/:serviceId")
  updateBinding(@Param("key") key: string, @Param("serviceId") serviceId: string, @Body() body: unknown) {
    return this.flags.updateBinding(key, serviceId, parseBindingPatch(body), parseActor(body));
  }
}
