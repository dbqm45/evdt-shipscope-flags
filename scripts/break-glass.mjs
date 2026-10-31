#!/usr/bin/env node
// Makes a new break-glass credential (PRD FR-002): a random password for the secrets vault and its scrypt hash for
// the API's BREAK_GLASS_PASSWORD_HASH. Nothing is stored here; the password is printed once.
//
//   npm run break-glass:new
//
// The API reads the hash with parseBreakGlassHash (src/auth/break-glass.ts); its tests check that it accepts what
// this script prints.

import { randomBytes, scryptSync } from "node:crypto";
import { fileURLToPath } from "node:url";

const N = 2 ** 15;
const r = 8;
const p = 1;

/** The scrypt hash of `password` in the format the API reads: scrypt:N:r:p:salt:hash (base64url). */
export function hashBreakGlassPassword(password, salt = randomBytes(16)) {
  const hash = scryptSync(password.normalize("NFC"), salt, 32, { N, r, p, maxmem: 256 * N * r + 1024 * 1024 });
  return `scrypt:${N}:${r}:${p}:${salt.toString("base64url")}:${hash.toString("base64url")}`;
}

/** A new credential: 192 random bits as the password, and its hash. */
export function newBreakGlassCredential() {
  const password = randomBytes(24).toString("base64url");
  return { password, hash: hashBreakGlassPassword(password) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { password, hash } = newBreakGlassCredential();
  console.log(`Password (store it in the secrets vault; it is not shown again):

  ${password}

Hash (set it on the API server):

  BREAK_GLASS_PASSWORD_HASH=${hash}

Changing the hash makes the previous password stop working.`);
}
