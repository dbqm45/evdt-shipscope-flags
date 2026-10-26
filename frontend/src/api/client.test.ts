import { beforeEach, describe, expect, it, vi } from "vitest";
import { flags as fixtureFlags } from "../data/mock";
import { api } from "./client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  // The client logs once when it falls back to fixture data.
  vi.spyOn(console, "info").mockImplementation(() => {});
});

describe("api client", () => {
  it("returns what the API sends", async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse([{ key: "from-api" }]));
    vi.stubGlobal("fetch", fetch);

    await expect(api.listFlags()).resolves.toEqual([{ key: "from-api" }]);
    expect(fetch).toHaveBeenCalledWith("/api/flags", expect.objectContaining({ method: "GET" }));
  });

  it("falls back to the fixture data when the API is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(api.listFlags()).resolves.toBe(fixtureFlags);
  });

  it("falls back to the fixture data when the dev proxy answers 502 (API not running)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Bad Gateway", { status: 502 })));
    await expect(api.listFlags()).resolves.toBe(fixtureFlags);
  });

  it("sends an environment toggle as PATCH with the new state and the actor", async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetch);

    await api.setEnvironmentState("new-checkout", "qa", true, "m.chen");

    expect(fetch).toHaveBeenCalledWith(
      "/api/flags/new-checkout/environments/qa",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ enabled: true, actor: "m.chen" }) }),
    );
  });
});
