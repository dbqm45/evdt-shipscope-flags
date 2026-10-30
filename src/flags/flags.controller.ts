import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import type { SignedInUser } from "../auth/auth-config.js";
import { Actor, CurrentUser, hasRole, RequireRole } from "../auth/auth.guard.js";
import { parseBindingPatch, parseCreateFlag, parseEnvironment, parseEnvironmentChange, parseFlagPatch } from "./flags.input.js";
import { FlagsService } from "./flags.service.js";

/** Management API for flags (used by the dashboard). Editors and Admins change flags. */
@Controller("flags")
@RequireRole("editor")
export class FlagsController {
  constructor(private readonly flags: FlagsService) {}

  @Get()
  list() {
    return this.flags.listFlags();
  }

  @Post()
  createFlag(@Body() body: unknown, @Actor() actor: string) {
    return this.flags.createFlag(parseCreateFlag(body), actor);
  }

  @Patch(":key")
  updateFlag(@Param("key") key: string, @Body() body: unknown, @CurrentUser() user: SignedInUser) {
    const patch = parseFlagPatch(body);
    // Per-flag notifications reach a chat channel even when the global switch is off: an Admin decision.
    if (patch.notify !== undefined && !hasRole(user, "admin")) throw new ForbiddenException("Only Admins can change a flag's notifications.");
    return this.flags.updateFlag(key, patch, user.username);
  }

  /** 409 with every reason when removing the flag could change a service's behaviour. */
  @Delete(":key")
  @HttpCode(200)
  async retireFlag(@Param("key") key: string, @Actor() actor: string) {
    await this.flags.retireFlag(key, actor);
    return { ok: true };
  }

  /** 409 when the promotion order or a dependency blocks the change; the attempt is logged either way. */
  @Patch(":key/environments/:env")
  async setEnvironment(@Param("key") key: string, @Param("env") env: string, @Body() body: unknown, @Actor() actor: string) {
    const enabled = parseEnvironmentChange(body);
    const flag = await this.flags.setEnvironment(key, parseEnvironment(env), enabled, actor);
    return { ok: true, flag };
  }

  @Patch(":key/services/:serviceId")
  updateBinding(@Param("key") key: string, @Param("serviceId") serviceId: string, @Body() body: unknown, @Actor() actor: string) {
    return this.flags.updateBinding(key, serviceId, parseBindingPatch(body), actor);
  }
}
