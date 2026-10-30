import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { Public } from "../auth/auth.guard.js";
import { PrismaService } from "../prisma/prisma.service.js";

const DB_TIMEOUT_MS = 2000;

/** GET /api/health: 200 when the API can reach its database, else 503. Used by the Docker healthcheck; not rate limited. */
@Controller("health")
@SkipThrottle()
@Public()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(): Promise<{ status: "ok"; database: "ok" }> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error("timeout")), DB_TIMEOUT_MS)));
    try {
      await Promise.race([this.prisma.$queryRaw`SELECT 1`, timeout]);
    } catch {
      throw new ServiceUnavailableException({ status: "error", database: "unreachable" });
    } finally {
      clearTimeout(timer);
    }
    return { status: "ok", database: "ok" };
  }
}
