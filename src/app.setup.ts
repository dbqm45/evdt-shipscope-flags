import type { INestApplication } from "@nestjs/common";
import helmet from "helmet";
import { authConfig } from "./auth/auth-config.js";
import { auditRetentionDays } from "./flags/audit-retention.js";
import { rateLimits, trustProxy } from "./rate-limit.js";

/** Settings shared by main.ts and the e2e tests, so the tests see the same routes as production. */
export function configureApp(app: INestApplication): INestApplication {
  // Fail at start-up on a malformed value rather than on the first request or the first pruning.
  rateLimits();
  auditRetentionDays();
  authConfig();
  app.setGlobalPrefix("api");
  // Security headers (nosniff, frame-ancestors, HSTS, …) and no X-Powered-By. The API serves JSON only.
  app.use(helmet());
  // Client addresses for the rate limits come from X-Forwarded-For only from proxies trusted here.
  (app.getHttpAdapter().getInstance() as { set(setting: string, value: unknown): void }).set("trust proxy", trustProxy());
  // Closes the database pool on SIGTERM (docker stop) instead of dropping in-flight queries.
  app.enableShutdownHooks();
  return app;
}
