import { beforeEach, describe, expect, it, vi } from "vitest";
import { auditLog as fixtureAudit, flags as fixtureFlags, services as fixtureServices } from "../data/mock";
import { api, ApiError, ApiUnavailableError } from "./client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Answers each path from `routes`; anything else is a 404. */
function stubApi(routes: Record<string, () => Response | Promise<Response>>) {
  const fetch = vi.fn((url: string) => (routes[url] ?? (() => jsonResponse({ message: "Not Found" }, 404)))());
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

beforeEach(() => {
  // The client logs once when it falls back to the demo data.
  vi.spyOn(console, "info").mockImplementation(() => {});
});

describe("api.load", () => {
  it("returns what the API sends, not in demo mode", async () => {
    stubApi({
      "/api/flags": () => jsonResponse([{ key: "from-api" }]),
      "/api/services": () => jsonResponse([]),
      "/api/audit-log": () => jsonResponse([]),
    });
    await expect(api.load()).resolves.toEqual({ flags: [{ key: "from-api" }], services: [], auditLog: [], demo: false });
  });

  it("falls back to the demo data when the API is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(api.load()).resolves.toEqual({ flags: fixtureFlags, services: fixtureServices, auditLog: fixtureAudit, demo: true });
  });

  it("falls back to the demo data when the dev proxy answers 502 (API not running)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Bad Gateway", { status: 502 })));
    await expect(api.load()).resolves.toMatchObject({ demo: true });
  });

  it("does not hide a failing API behind demo data", async () => {
    stubApi({
      "/api/flags": () => jsonResponse({ message: "Internal server error" }, 500),
      "/api/services": () => jsonResponse([]),
      "/api/audit-log": () => jsonResponse([]),
    });
    await expect(api.load()).rejects.toEqual(new ApiError("Internal server error", 500));
  });
});

describe("api.setEnvironmentState", () => {
  it("sends PATCH with the new state and the actor, with the flag key encoded", async () => {
    const fetch = stubApi({ "/api/flags/new%2Fcheckout/environments/qa": () => jsonResponse({ ok: true, flag: { key: "new/checkout" } }) });

    await expect(api.setEnvironmentState("new/checkout", "qa", true, "m.chen")).resolves.toEqual({ ok: true, flag: { key: "new/checkout" } });
    expect(fetch).toHaveBeenCalledWith(
      "/api/flags/new%2Fcheckout/environments/qa",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ enabled: true, actor: "m.chen" }) }),
    );
  });

  it("throws the server's reason when the API refuses the change", async () => {
    stubApi({ "/api/flags/a/environments/prod": () => jsonResponse({ message: "Enable in qa first.", statusCode: 409 }, 409) });
    await expect(api.setEnvironmentState("a", "prod", true, "m.chen")).rejects.toEqual(new ApiError("Enable in qa first.", 409));
  });

  it("throws ApiUnavailableError when the API cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(api.setEnvironmentState("a", "test", true, "m.chen")).rejects.toBeInstanceOf(ApiUnavailableError);
  });
});
