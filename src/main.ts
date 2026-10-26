import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { configureApp } from "./app.setup.js";

async function bootstrap() {
  const app = configureApp(await NestFactory.create(AppModule));
  if (process.env.SDK_TOKEN) new Logger("Bootstrap").warn("SDK_TOKEN is set: the shared SDK token is still accepted next to service credentials (deprecated).");
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
