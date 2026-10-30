import { Body, Controller, Get, Post, Put } from "@nestjs/common";
import { Actor, RequireRole } from "../auth/auth.guard.js";
import { parseNotificationSettings, parseRuleSettings } from "./flags.input.js";
import { FlagsService } from "./flags.service.js";

/** Prod change notifications (the webhook URL only ever leaves the server masked; Editors and Admins) and rule thresholds (Admins). */
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

  @Put("notifications")
  @RequireRole("editor")
  set(@Body() body: unknown) {
    return this.flags.setNotifications(parseNotificationSettings(body));
  }

  @Post("notifications/test")
  @RequireRole("editor")
  test() {
    return this.flags.testNotification();
  }
}
