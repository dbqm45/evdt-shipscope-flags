import { SetMetadata, type ExecutionContext } from "@nestjs/common";
import type { ThrottlerModuleOptions } from "@nestjs/throttler";

// Request limits per client address and route, in a fixed one-minute window, kept in this process's memory (one API
// instance). Over the limit the API answers 429 with Retry-After. Behind a reverse proxy set TRUST_PROXY, or every
// request counts as coming from the proxy.

const MINUTE = 60_000;
const SDK_ROUTE = "shipscope:sdk-route";

/** Marks the consumer endpoint, which services poll and which gets its own, higher limit. */
export const SdkRoute = () => SetMetadata(SDK_ROUTE, true);

function perMinute(name: string, fallback: number, env: NodeJS.ProcessEnv): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a whole number of requests per minute (0 turns the limit off), not "${raw}".`);
  return value;
}

/** Requests per minute for the management API and for the consumer endpoint; 0 = no limit. Throws on a bad value. */
export function rateLimits(env = process.env): { api: number; sdk: number } {
  return { api: perMinute("RATE_LIMIT_PER_MINUTE", 300, env), sdk: perMinute("RATE_LIMIT_SDK_PER_MINUTE", 600, env) };
}

const limitFor = (context: ExecutionContext) => {
  const limits = rateLimits();
  return Reflect.getMetadata(SDK_ROUTE, context.getHandler()) === true ? limits.sdk : limits.api;
};

/** One throttler named "default", so the 429 carries the standard Retry-After header (named ones get a suffix). */
export const throttlerOptions: ThrottlerModuleOptions = {
  throttlers: [{ ttl: MINUTE, limit: limitFor, skipIf: (context) => limitFor(context) === 0 }],
  errorMessage: "Too many requests: retry after the number of seconds in the Retry-After header.",
};

/** Express "trust proxy" from TRUST_PROXY: a hop count, true/false, or addresses/subnets such as "loopback, uniquelocal". */
export function trustProxy(raw = process.env.TRUST_PROXY): boolean | number | string {
  const value = raw?.trim();
  if (!value || value === "false") return false;
  if (value === "true") return true;
  return /^\d+$/.test(value) ? Number(value) : value;
}
