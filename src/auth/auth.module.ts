import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller.js";
import { OidcClient } from "./oidc.js";
import { Sessions } from "./sessions.js";

@Module({
  controllers: [AuthController],
  providers: [OidcClient, Sessions],
  exports: [Sessions],
})
export class AuthModule {}
