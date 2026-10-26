import type { INestApplication } from "@nestjs/common";

/** Settings shared by main.ts and the e2e tests, so the tests see the same routes as production. */
export function configureApp(app: INestApplication): INestApplication {
  app.setGlobalPrefix("api");
  // Closes the database pool on SIGTERM (docker stop) instead of dropping in-flight queries.
  app.enableShutdownHooks();
  return app;
}
