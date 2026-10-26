import { Body, Controller, Get, Post, Put } from "@nestjs/common";
import { parseNotificationSettings } from "./flags.input.js";
import { FlagsService } from "./flags.service.js";

/** Prod change notifications; the webhook URL only ever leaves the server masked. */
@Controller("settings/notifications")
export class SettingsController {
  constructor(private readonly flags: FlagsService) {}

  @Get()
  get() {
    return this.flags.getNotifications();
  }

  @Put()
  set(@Body() body: unknown) {
    return this.flags.setNotifications(parseNotificationSettings(body));
  }

  @Post("test")
  test() {
    return this.flags.testNotification();
  }
}
