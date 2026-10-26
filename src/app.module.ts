import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { FlagsModule } from "./flags/flags.module.js";
import { HealthController } from "./health/health.controller.js";
import { PrismaModule } from "./prisma/prisma.service.js";
import { throttlerOptions } from "./rate-limit.js";

@Module({
  imports: [PrismaModule, FlagsModule, ThrottlerModule.forRoot(throttlerOptions)],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
