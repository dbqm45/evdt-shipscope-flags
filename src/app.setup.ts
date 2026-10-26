import type { INestApplication } from "@nestjs/common";
import helmet from "helmet";
import { rateLimits, trustProxy } from "./rate-limit.js";

/** Settings shared by main.ts and the e2e tests, so the tests see the same routes as production. */
export function configureApp(app: INestApplication): INestApplication {
  rateLimits(); // fails at start-up on a malformed RATE_LIMIT_* value rather than on the first request
  app.setGlobalPrefix("api");
  // Security headers (nosniff, frame-ancestors, HSTS, …) and no X-Powered-By. The API serves JSON only.
  app.use(helmet());
  // Client addresses for the rate limits come from X-Forwarded-For only from proxies trusted here.
  (app.getHttpAdapter().getInstance() as { set(setting: string, value: unknown): void }).set("trust proxy", trustProxy());
  // Closes the database pool on SIGTERM (docker stop) instead of dropping in-flight queries.
  app.enableShutdownHooks();
  return app;
}
