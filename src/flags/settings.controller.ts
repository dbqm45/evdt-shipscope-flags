import { Body, Controller, Get, Post, Put } from "@nestjs/common";
import { parseActor, parseNotificationSettings, parseRuleSettings } from "./flags.input.js";
import { FlagsService } from "./flags.service.js";

/** Prod change notifications (the webhook URL only ever leaves the server masked) and rule thresholds. */
@Controller("settings")
export class SettingsController {
  constructor(private readonly flags: FlagsService) {}

  @Get("rules")
  rules() {
    return this.flags.getRuleSettings();
  }

  /** Every change is noted in the audit log. */
  @Put("rules")
  setRules(@Body() body: unknown) {
    return this.flags.setRuleSettings(parseRuleSettings(body), parseActor(body));
  }

  @Get("notifications")
  get() {
    return this.flags.getNotifications();
  }

  @Put("notifications")
  set(@Body() body: unknown) {
    return this.flags.setNotifications(parseNotificationSettings(body));
  }

  @Post("notifications/test")
  test() {
    return this.flags.testNotification();
  }
}
