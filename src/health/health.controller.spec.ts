import { ServiceUnavailableException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service.js";
import { HealthController } from "./health.controller.js";

const withDatabase = (query: () => Promise<unknown>) => new HealthController({ $queryRaw: query } as unknown as PrismaService);

describe("HealthController", () => {
  it("is ok when the database answers", async () => {
    await expect(withDatabase(async () => [{ "?column?": 1 }]).check()).resolves.toEqual({ status: "ok", database: "ok" });
  });

  it("answers 503 when the database fails", async () => {
    const check = withDatabase(() => Promise.reject(new Error("connection refused"))).check();
    await expect(check).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(check).rejects.toMatchObject({ response: { status: "error", database: "unreachable" } });
  });

  it("answers 503 when the database does not answer within 2 seconds", async () => {
    vi.useFakeTimers();
    try {
      const check = withDatabase(() => new Promise(() => {})).check();
      const outcome = expect(check).rejects.toBeInstanceOf(ServiceUnavailableException);
      await vi.advanceTimersByTimeAsync(2000);
      await outcome;
    } finally {
      vi.useRealTimers();
    }
  });
});
