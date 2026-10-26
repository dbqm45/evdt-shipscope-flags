import { Module } from "@nestjs/common";
import { AppController } from "./app.controller.js";
import { AppService } from "./app.service.js";
import { FlagsModule } from "./flags/flags.module.js";

@Module({
  imports: [FlagsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
