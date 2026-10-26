import { UnauthorizedException } from "@nestjs/common";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// Who is reading flags through the consumer endpoint GET /api/sdk/flags (PRD FR-003/005/011). Each service sends its
// own credential, "Authorization: Bearer <credential>"; the server stores only its SHA-256 digest. The shared
// SDK_TOKEN from 0.3 is still accepted while services move to their own credentials.

/** How long a credential replaced by a rotation keeps working, so the service can be redeployed with the new one. */
export const CREDENTIAL_GRACE_MS = 24 * 60 * 60 * 1000;

/** A new service credential: 256 random bits, with a prefix that makes a leaked one easy to recognise. */
export const newServiceToken = () => `ssf_${randomBytes(32).toString("base64url")}`;

const sha256 = (value: string) => createHash("sha256").update(value).digest();

/** What is stored for a credential. Credentials are random, so a plain SHA-256 needs no salt or slow hash. */
export const hashToken = (token: string) => sha256(token).toString("hex");

export type SdkCaller = { service: { id: string; key: string } } | { shared: true };

/**
 * Identifies the caller from the Authorization header: a service by its credential (`findService` looks up the digest),
 * else the shared SDK_TOKEN when the server has one. Anything else is a 401.
 */
export async function identifySdkCaller(
  authorization: string | undefined,
  findService: (tokenHash: string) => Promise<{ id: string; key: string } | null>,
  sharedToken = process.env.SDK_TOKEN,
): Promise<SdkCaller> {
  const sent = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : "";
  if (!sent) throw new UnauthorizedException('Missing SDK credential: send "Authorization: Bearer <service credential>".');
  const service = await findService(hashToken(sent));
  if (service) return { service };
  // Compared through fixed-length digests in constant time, so the response time does not leak the token.
  if (sharedToken && timingSafeEqual(sha256(sent), sha256(sharedToken))) return { shared: true };
  throw new UnauthorizedException("Invalid or expired SDK credential.");
}
