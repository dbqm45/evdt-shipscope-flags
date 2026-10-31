import { Module } from "@nestjs/common";
import { FlagsModule } from "../flags/flags.module.js";
import { AuthController } from "./auth.controller.js";
import { OidcClient } from "./oidc.js";
import { Sessions } from "./sessions.js";

@Module({
  imports: [FlagsModule],
  controllers: [AuthController],
  providers: [OidcClient, Sessions],
  exports: [Sessions],
})
export class AuthModule {}
