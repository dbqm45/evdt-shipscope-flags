import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AuthGuard } from "./auth/auth.guard.js";
import { AuthModule } from "./auth/auth.module.js";
import { FlagsModule } from "./flags/flags.module.js";
import { HealthController } from "./health/health.controller.js";
import { PrismaModule } from "./prisma/prisma.service.js";
import { throttlerOptions } from "./rate-limit.js";

@Module({
  imports: [PrismaModule, AuthModule, FlagsModule, ThrottlerModule.forRoot(throttlerOptions)],
  controllers: [HealthController],
  // Rate limits first, so a flood of unauthenticated requests is stopped before it reaches the session lookup.
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
