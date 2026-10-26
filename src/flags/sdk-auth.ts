import { ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { createHash, timingSafeEqual } from "node:crypto";

const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * Guards the consumer endpoint GET /api/sdk/flags: callers send "Authorization: Bearer <SDK_TOKEN>". Without SDK_TOKEN
 * on the server the endpoint answers 503 instead of serving flags to anyone; service clients treat that like an
 * outage and keep their cached state (PRD FR-012).
 */
export function checkSdkToken(authorization: string | undefined, token = process.env.SDK_TOKEN): void {
  if (!token) throw new ServiceUnavailableException("SDK access is not configured on the server: set SDK_TOKEN.");
  const sent = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
  // Compared through fixed-length digests in constant time, so the response time does not leak the token.
  if (!sent || !timingSafeEqual(digest(sent), digest(token))) throw new UnauthorizedException("Missing or invalid SDK token.");
}
