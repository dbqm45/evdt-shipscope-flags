import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { FlagClient, type FlagClientError, type FlagClientOptions } from "./client.ts";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

/** A fetch that answers from `answers` in turn (the last one repeats) and records the requests. */
function server(...answers: Array<() => Response | Promise<Response>>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return (answers[Math.min(calls.length - 1, answers.length - 1)] ?? (() => json({}, 500)))();
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const down = () => Promise.reject(new TypeError("fetch failed"));

let dir: string;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), "flag-client-"));
});
after(async () => {
  await rm(dir, { recursive: true, force: true });
});

function client(overrides: Partial<FlagClientOptions>) {
  const errors: FlagClientError[] = [];
  const options: FlagClientOptions = {
    baseUrl: "https://flags.example.test/",
    env: "prod",
    credential: "ssf_secret",
    defaults: { fromCode: true, newCheckout: false },
    onError: (e) => errors.push(e),
    ...overrides,
  };
  return { options, errors };
}

describe("FlagClient", () => {
  it("reads its environment with its credential and serves the server's values", async () => {
    const { fetch, calls } = server(() => json({ env: "prod", flags: { newCheckout: true } }));
    const { options } = client({ fetch });

    const flags = await FlagClient.start(options);
    flags.stop();

    assert.equal(calls[0].url, "https://flags.example.test/api/v1/sdk/flags?env=prod");
    assert.deepEqual(calls[0].init?.headers, { Authorization: "Bearer ssf_secret" });
    assert.equal(flags.isEnabled("newCheckout"), true);
    assert.equal(flags.state.source, "server");
  });

  it("falls back to the code's default for a flag the server does not return, and to false for an unknown one", async () => {
    const { fetch } = server(() => json({ env: "prod", flags: {} }));
    const flags = await FlagClient.start(client({ fetch }).options);
    flags.stop();

    assert.equal(flags.isEnabled("fromCode"), true);
    assert.equal(flags.isEnabled("neverHeardOf"), false);
  });

  it("keeps serving the last good state when the server goes down, refuses the credential or answers garbage", async () => {
    const { fetch } = server(
      () => json({ env: "prod", flags: { newCheckout: true } }),
      down,
      () => json({ statusCode: 401, message: "Invalid or expired SDK credential." }, 401),
      () => new Response("<html>bad gateway</html>", { status: 200 }),
    );
    const { options, errors } = client({ fetch });
    const flags = new FlagClient(options);

    assert.deepEqual(await flags.refresh(), { ok: true });
    for (let i = 0; i < 3; i++) assert.deepEqual(await flags.refresh(), { ok: false });

    assert.equal(flags.isEnabled("newCheckout"), true);
    assert.equal(flags.state.source, "cache");
    assert.deepEqual(
      errors.map((e) => e.kind),
      ["unavailable", "credential", "unavailable"],
    );
    assert.match(errors[1].message, /401: Invalid or expired SDK credential/);
  });

  it("serves the defaults while nothing is known", async () => {
    const { options, errors } = client({ fetch: server(down).fetch });
    const flags = await FlagClient.start(options);
    flags.stop();

    assert.equal(flags.state.source, "defaults");
    assert.equal(flags.isEnabled("fromCode"), true);
    assert.equal(errors[0].kind, "unavailable");
  });

  it("gives up on a slow server after timeoutMs", async () => {
    // AbortSignal.timeout does not keep the process alive, so the hanging request holds a timer of its own.
    const hanging = ((_url: string, init?: RequestInit) =>
      new Promise((_, reject) => {
        const alive = setTimeout(() => {}, 5000);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(alive);
          reject(init.signal!.reason);
        });
      })) as typeof globalThis.fetch;
    const { options, errors } = client({ fetch: hanging, timeoutMs: 20 });

    assert.deepEqual(await new FlagClient(options).refresh(), { ok: false });
    assert.equal(errors[0].kind, "unavailable");
  });

  it("waits as long as a 429 asks", async () => {
    const { fetch } = server(() => json({ message: "Too many requests" }, 429, { "Retry-After": "42" }));
    const { options, errors } = client({ fetch });

    assert.deepEqual(await new FlagClient(options).refresh(), { ok: false, retryAfterMs: 42_000 });
    assert.equal(errors[0].kind, "rate-limited");
  });

  it("stores the last good state on disk and starts from it during an outage", async () => {
    const cacheFile = join(dir, "flags.json");
    const first = await FlagClient.start(client({ fetch: server(() => json({ env: "prod", flags: { newCheckout: true } })).fetch, cacheFile }).options);
    first.stop();
    assert.deepEqual(JSON.parse(await readFile(cacheFile, "utf8")).flags, { newCheckout: true });

    const restarted = await FlagClient.start(client({ fetch: server(down).fetch, cacheFile }).options);
    restarted.stop();
    assert.equal(restarted.state.source, "cache");
    assert.equal(restarted.isEnabled("newCheckout"), true);
  });

  it("ignores a cache file of another environment or a broken one", async () => {
    const otherEnv = join(dir, "qa.json");
    await writeFile(otherEnv, JSON.stringify({ env: "qa", flags: { newCheckout: true }, fetchedAt: "2026-10-26T10:00:00.000Z" }));
    const broken = join(dir, "broken.json");
    await writeFile(broken, "{ not json");

    for (const cacheFile of [otherEnv, broken, join(dir, "missing.json")]) {
      const flags = new FlagClient(client({ cacheFile }).options);
      await flags.loadCache();
      assert.equal(flags.state.source, "defaults", cacheFile);
      assert.equal(flags.isEnabled("newCheckout"), false);
    }
  });
});
