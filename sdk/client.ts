// Reference client for the ShipScope Flags consumer endpoint (docs/sdk-api.md). One file, no dependencies, plain
// TypeScript that Node runs as is (type stripping, Node 22.18+); copy it into a service or import it.
//
//   const flags = await FlagClient.start({
//     baseUrl: "https://flags.example.com", env: "prod", credential: process.env.SHIPSCOPE_FLAGS_TOKEN!,
//     defaults: { newCheckout: false }, cacheFile: "/var/cache/my-service/flags.json",
//   });
//   if (flags.isEnabled("newCheckout")) { ... }
//
// It never makes the flag service a single point of failure (PRD FR-012): it polls every `intervalMs`, keeps the last
// good answer in memory and, with `cacheFile`, on disk for the next start, and keeps serving it whenever the server
// is down, slow, refuses the credential or rate limits it. Without any known state it serves `defaults`.

import { readFile, rename, writeFile } from "node:fs/promises";

export type Environment = "test" | "qa" | "prod";

export interface FlagClientOptions {
  /** Where ShipScope Flags runs, e.g. "https://flags.example.com" (the client adds /api/v1/sdk/flags). */
  baseUrl: string;
  /** The environment this deployment of the service runs in; read only this one. */
  env: Environment;
  /** The service's own credential (dashboard → Services). */
  credential: string;
  /** The values in the service's code: used for a flag the server does not return, and before anything is known. */
  defaults?: Record<string, boolean>;
  /** Time between reads; at most 60 s, so a change reaches the service within a minute (the default). */
  intervalMs?: number;
  /** A read slower than this counts as failed (default 3 s). */
  timeoutMs?: number;
  /** File holding the last good answer, so a restart during an outage starts from it rather than from `defaults`. */
  cacheFile?: string;
  /** Called on every failed read; the client keeps serving what it has. Defaults to console.warn. */
  onError?: (error: FlagClientError) => void;
  /** For tests: the fetch to use. */
  fetch?: typeof fetch;
}

/**
 * Why a read failed. `credential` (401) and `config` (400, 403) need a person: the credential was rotated or revoked,
 * or the client is set up wrongly. `unavailable` (network, timeout, 5xx) and `rate-limited` (429) pass on their own.
 */
export class FlagClientError extends Error {
  readonly kind: "credential" | "config" | "rate-limited" | "unavailable";
  readonly status?: number;

  constructor(kind: FlagClientError["kind"], message: string, status?: number) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

export interface FlagState {
  flags: Record<string, boolean>;
  /** server: the last read succeeded; cache: from the cache file (or an earlier read) while reads fail; defaults: nothing known yet. */
  source: "server" | "cache" | "defaults";
  /** When the server produced these flags. */
  fetchedAt?: string;
}

interface CacheFile {
  env: Environment;
  flags: Record<string, boolean>;
  fetchedAt: string;
}

const MAX_INTERVAL_MS = 60_000;

export class FlagClient {
  readonly #options: FlagClientOptions;
  readonly #interval: number;
  #state: FlagState = { flags: {}, source: "defaults" };
  #timer: ReturnType<typeof setTimeout> | undefined;
  #stopped = false;

  constructor(options: FlagClientOptions) {
    this.#options = options;
    this.#interval = Math.min(options.intervalMs ?? MAX_INTERVAL_MS, MAX_INTERVAL_MS);
  }

  /** Loads the cache file, reads the server once (a failure is not thrown) and keeps reading in the background. */
  static async start(options: FlagClientOptions): Promise<FlagClient> {
    const client = new FlagClient(options);
    await client.loadCache();
    const result = await client.refresh();
    client.#schedule(result.retryAfterMs);
    return client;
  }

  /** The flag's value: from the last known state, else the code's default, else false. */
  isEnabled(key: string): boolean {
    return this.#state.flags[key] ?? this.#options.defaults?.[key] ?? false;
  }

  get state(): FlagState {
    return this.#state;
  }

  /** Stops the background reads. */
  stop(): void {
    this.#stopped = true;
    clearTimeout(this.#timer);
  }

  /** Reads the server once. On failure keeps the current state and reports it; `retryAfterMs` comes from a 429. */
  async refresh(): Promise<{ ok: boolean; retryAfterMs?: number }> {
    const { baseUrl, env, credential, timeoutMs = 3000 } = this.#options;
    const url = `${baseUrl.replace(/\/+$/, "")}/api/v1/sdk/flags?env=${encodeURIComponent(env)}`;
    let res: Response;
    try {
      res = await (this.#options.fetch ?? fetch)(url, { headers: { Authorization: `Bearer ${credential}` }, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      return this.#failed(new FlagClientError("unavailable", `ShipScope Flags is not reachable: ${(err as Error).message}`));
    }
    if (res.status === 429) {
      const retryAfterMs = Number(res.headers.get("retry-after")) * 1000 || undefined;
      return { ...this.#failed(new FlagClientError("rate-limited", "ShipScope Flags rate limited this service.", 429)), retryAfterMs };
    }
    if (!res.ok) {
      const kind = res.status === 401 ? "credential" : res.status === 400 || res.status === 403 ? "config" : "unavailable";
      return this.#failed(new FlagClientError(kind, `ShipScope Flags answered ${res.status}: ${await reason(res)}`, res.status));
    }
    let body: { env?: unknown; flags?: unknown };
    try {
      body = (await res.json()) as typeof body;
    } catch (err) {
      return this.#failed(new FlagClientError("unavailable", `ShipScope Flags sent an unreadable answer: ${(err as Error).message}`, res.status));
    }
    if (body.env !== env || !isFlagMap(body.flags))
      return this.#failed(new FlagClientError("unavailable", "ShipScope Flags sent an unexpected answer.", res.status));
    this.#state = { flags: body.flags, source: "server", fetchedAt: new Date().toISOString() };
    await this.#saveCache();
    return { ok: true };
  }

  /** Starts from the cache file when it holds a state for this environment; a missing or broken file is ignored. */
  async loadCache(): Promise<void> {
    const { cacheFile, env } = this.#options;
    if (!cacheFile) return;
    try {
      const cached = JSON.parse(await readFile(cacheFile, "utf8")) as Partial<CacheFile>;
      if (cached.env === env && isFlagMap(cached.flags)) this.#state = { flags: cached.flags, source: "cache", fetchedAt: cached.fetchedAt };
    } catch {
      // no usable cache: start from the defaults
    }
  }

  #failed(error: FlagClientError): { ok: false } {
    if (this.#state.source === "server") this.#state = { ...this.#state, source: "cache" };
    (this.#options.onError ?? ((e) => console.warn(`[shipscope-flags] ${e.message} Serving the last known state.`)))(error);
    return { ok: false };
  }

  async #saveCache(): Promise<void> {
    const { cacheFile, env } = this.#options;
    if (!cacheFile) return;
    const data: CacheFile = { env, flags: this.#state.flags, fetchedAt: this.#state.fetchedAt! };
    try {
      // Written next to the file and renamed, so a crash mid-write never leaves a broken cache.
      await writeFile(`${cacheFile}.tmp`, JSON.stringify(data));
      await rename(`${cacheFile}.tmp`, cacheFile);
    } catch (err) {
      this.#options.onError?.(new FlagClientError("unavailable", `Could not write the flag cache ${cacheFile}: ${(err as Error).message}`));
    }
  }

  #schedule(retryAfterMs?: number): void {
    if (this.#stopped) return;
    // Up to 10% jitter, so many instances started together do not read in lockstep.
    const delay = Math.max(this.#interval, retryAfterMs ?? 0) * (1 - Math.random() * 0.1);
    this.#timer = setTimeout(() => void this.refresh().then((r) => this.#schedule(r.retryAfterMs)), delay);
    // The reads never keep the process alive on their own.
    this.#timer.unref?.();
  }
}

function isFlagMap(value: unknown): value is Record<string, boolean> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.values(value).every((v) => typeof v === "boolean");
}

async function reason(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: unknown };
    return typeof body.message === "string" ? body.message : res.statusText;
  } catch {
    return res.statusText;
  }
}
