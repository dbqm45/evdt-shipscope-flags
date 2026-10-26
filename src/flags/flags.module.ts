import { Module } from "@nestjs/common";
import { AuditLogController } from "./audit-log.controller.js";
import { AuditRetention } from "./audit-retention.js";
import { FlagsController } from "./flags.controller.js";
import { FlagsService } from "./flags.service.js";
import { SdkController } from "./sdk.controller.js";
import { ServicesController } from "./services.controller.js";
import { SettingsController } from "./settings.controller.js";

@Module({
  controllers: [FlagsController, ServicesController, AuditLogController, SettingsController, SdkController],
  providers: [FlagsService, AuditRetention],
})
export class FlagsModule {}
