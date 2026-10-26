import { Module } from "@nestjs/common";
import { AppController } from "./app.controller.js";
import { AppService } from "./app.service.js";
import { FlagsModule } from "./flags/flags.module.js";
import { PrismaModule } from "./prisma/prisma.service.js";

@Module({
  imports: [PrismaModule, FlagsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
