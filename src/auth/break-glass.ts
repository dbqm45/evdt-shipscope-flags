import { scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

// Break-glass access (PRD FR-002): one Admin login that does not depend on the identity provider, for an outage of
// it. The password lives in the organisation's secrets vault; the API holds only its scrypt hash
// (BREAK_GLASS_PASSWORD_HASH, made by `npm run break-glass:new`). Every use, and every failed attempt, is written to
// the audit log and announced on the notification webhook.

/** Who the audit log names for changes made in a break-glass session. */
export const BREAK_GLASS_USERNAME = "break-glass";
/** A break-glass session is short: long enough to fix what is urgent, not to work in. */
export const BREAK_GLASS_SESSION_MS = 60 * 60 * 1000;

export interface BreakGlassHash {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
}

const FORMAT = "scrypt:N:r:p:salt:hash (base64url), as `npm run break-glass:new` prints it";

/** Reads a stored hash "scrypt:<N>:<r>:<p>:<salt>:<hash>". Throws on anything else. */
export function parseBreakGlassHash(raw: string): BreakGlassHash {
  const parts = raw.trim().split(":");
  const [scheme, n, r, p, salt, hash] = parts;
  const num = (value: string | undefined) => (/^\d+$/.test(value ?? "") ? Number(value) : NaN);
  const parsed = { N: num(n), r: num(r), p: num(p), salt: Buffer.from(salt ?? "", "base64url"), hash: Buffer.from(hash ?? "", "base64url") };
  const valid =
    parts.length === 6 &&
    scheme === "scrypt" &&
    parsed.N >= 2 ** 14 &&
    (parsed.N & (parsed.N - 1)) === 0 &&
    parsed.r >= 8 &&
    parsed.p >= 1 &&
    parsed.salt.length >= 16 &&
    parsed.hash.length >= 32;
  if (!valid) throw new Error(`BREAK_GLASS_PASSWORD_HASH must be ${FORMAT}, with N ≥ 16384, r ≥ 8, a salt of ≥ 16 bytes and a hash of ≥ 32 bytes.`);
  return parsed;
}

/** The stored hash from BREAK_GLASS_PASSWORD_HASH, or null when break-glass access is off. Throws on a malformed one. */
export function breakGlassHash(env = process.env): BreakGlassHash | null {
  const raw = env.BREAK_GLASS_PASSWORD_HASH?.trim();
  return raw ? parseBreakGlassHash(raw) : null;
}

const derive = (password: string, { N, r, p, salt, hash }: BreakGlassHash) =>
  new Promise<Buffer>((resolve, reject) => {
    const options: ScryptOptions = { N, r, p, maxmem: 256 * N * r + 1024 * 1024 };
    scrypt(password.normalize("NFC"), salt, hash.length, options, (err, key) => (err ? reject(err) : resolve(key)));
  });

/** Whether `password` matches the stored hash; compared in constant time. */
export async function verifyBreakGlassPassword(password: string, stored: BreakGlassHash): Promise<boolean> {
  if (!password) return false;
  return timingSafeEqual(await derive(password, stored), stored.hash);
}
