import { Body, Controller, Get, Post, Put } from "@nestjs/common";
import { Actor } from "../auth/auth.guard.js";
import { parseNotificationSettings, parseRuleSettings } from "./flags.input.js";
import { FlagsService } from "./flags.service.js";

/**
 * Prod change notifications (the webhook URL only ever leaves the server masked) and rule thresholds: Admins only. The
 * webhook also carries the break-glass alerts, so whoever could redirect it could hide those.
 */
@Controller("settings")
export class SettingsController {
  constructor(private readonly flags: FlagsService) {}

  @Get("rules")
  rules() {
    return this.flags.getRuleSettings();
  }

  /** Every change is noted in the audit log. */
  @Put("rules")
  setRules(@Body() body: unknown, @Actor() actor: string) {
    return this.flags.setRuleSettings(parseRuleSettings(body), actor);
  }

  @Get("notifications")
  get() {
    return this.flags.getNotifications();
  }

  /** Every change is noted in the audit log. */
  @Put("notifications")
  set(@Body() body: unknown, @Actor() actor: string) {
    return this.flags.setNotifications(parseNotificationSettings(body), actor);
  }

  @Post("notifications/test")
  test() {
    return this.flags.testNotification();
  }
}
