import { BadRequestException } from "@nestjs/common";
import {
  encodeAuditCursor,
  parseActor,
  parseAuditQuery,
  parseBindingPatch,
  parseCreateFlag,
  parseFlagPatch,
  parseNotificationSettings,
  parseRegisterService,
  parseRotateCredential,
} from "./flags.input.js";

const reason = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(BadRequestException);
    return (err as Error).message;
  }
  throw new Error("expected a 400");
};

describe("parseCreateFlag", () => {
  it("accepts a minimal flag and fills the defaults", () => {
    expect(parseCreateFlag({ key: " new-search ", type: "release" })).toEqual({
      key: "new-search",
      description: "",
      type: "release",
      serviceIds: [],
      dependsOn: undefined,
      owner: undefined,
      reviewBy: undefined,
      tags: [],
    });
  });

  it("treats empty optional fields as not set and drops duplicate services and blank tags", () => {
    expect(
      parseCreateFlag({ key: "a", type: "feature", dependsOn: "", owner: " ", reviewBy: "", serviceIds: ["s1", "s1"], tags: ["x", " ", "x"] }),
    ).toMatchObject({
      dependsOn: undefined,
      owner: undefined,
      reviewBy: undefined,
      serviceIds: ["s1"],
      tags: ["x"],
    });
  });

  it("rejects what the dashboard would never send", () => {
    expect(reason(() => parseCreateFlag({ key: "has space", type: "release" }))).toMatch(/Flag key is required/);
    expect(reason(() => parseCreateFlag({ key: "a", type: "experiment" }))).toMatch(/"type" must be/);
    expect(reason(() => parseCreateFlag({ key: "a", type: "release", serviceIds: "s1" }))).toMatch(/"serviceIds"/);
    expect(reason(() => parseCreateFlag({ key: "a", type: "release", reviewBy: "soon" }))).toMatch(/"reviewBy" must be a date/);
    expect(reason(() => parseCreateFlag({ key: "a", type: "release", enabled: true }))).toBe("Unknown field: enabled.");
    expect(reason(() => parseCreateFlag(["a"]))).toMatch(/JSON object/);
  });
});

describe("parseFlagPatch and parseBindingPatch", () => {
  it("maps empty values to null (clear) and rejects an empty or unknown patch", () => {
    expect(parseFlagPatch({ owner: "", reviewBy: null, actor: "m.chen" })).toEqual({ owner: null, reviewBy: null });
    expect(reason(() => parseFlagPatch({ actor: "m.chen" }))).toMatch(/Nothing to change/);
    expect(reason(() => parseFlagPatch({ key: "renamed" }))).toBe("Unknown field: key.");
  });

  it("validates read modes and build-time values per environment", () => {
    expect(parseBindingPatch({ readMode: "build-time", buildTimeValues: { prod: false } })).toEqual({
      readMode: "build-time",
      buildTimeValues: { prod: false },
    });
    expect(reason(() => parseBindingPatch({ readMode: "sometimes" }))).toMatch(/"readMode" must be one of/);
    expect(reason(() => parseBindingPatch({ buildTimeValues: { staging: true } }))).toBe("Unknown field: staging.");
    expect(reason(() => parseBindingPatch({ buildTimeValues: { qa: "yes" } }))).toMatch(/true or false/);
  });

  it("takes the actor from the body, defaulting to api", () => {
    expect(parseActor({ actor: "m.chen" })).toBe("m.chen");
    expect(parseActor({})).toBe("api");
    expect(parseActor(undefined)).toBe("api");
  });
});

describe("parseNotificationSettings", () => {
  it("passes only enabled and webhookUrl, with their types checked", () => {
    expect(parseNotificationSettings({ enabled: true })).toEqual({ enabled: true });
    expect(parseNotificationSettings({ webhookUrl: " https://hooks.slack.com/x " })).toEqual({ webhookUrl: "https://hooks.slack.com/x" });
    expect(reason(() => parseNotificationSettings({ enabled: "yes" }))).toMatch(/"enabled" must be true or false/);
    expect(reason(() => parseNotificationSettings({ url: "x" }))).toBe("Unknown field: url.");
  });
});

describe("service registration and credential rotation", () => {
  it("takes a service key and an optional name, which defaults to the key", () => {
    expect(parseRegisterService({ key: " billing-api ", actor: "a.kowalska" })).toEqual({ key: "billing-api", name: "billing-api" });
    expect(parseRegisterService({ key: "billing-api", name: "Billing API" })).toEqual({ key: "billing-api", name: "Billing API" });
    expect(reason(() => parseRegisterService({ key: "billing api" }))).toMatch(/^Service key is required/);
    expect(reason(() => parseRegisterService({ key: "x", token: "mine" }))).toBe("Unknown field: token.");
  });

  it("revokes the previous credential only when asked to", () => {
    expect(parseRotateCredential({})).toEqual({ revokePrevious: false });
    expect(parseRotateCredential(undefined)).toEqual({ revokePrevious: false });
    expect(parseRotateCredential({ revokePrevious: true, actor: "a.kowalska" })).toEqual({ revokePrevious: true });
    expect(reason(() => parseRotateCredential({ revokePrevious: "yes" }))).toMatch(/true or false/);
  });
});

describe("parseAuditQuery", () => {
  it("defaults to 50 entries and checks limit, action and cursor", () => {
    expect(parseAuditQuery({})).toEqual({ limit: 50 });
    expect(parseAuditQuery({ limit: "10", action: "env-enabled", flagKey: "a", q: " evse " })).toMatchObject({
      limit: 10,
      action: "env-enabled",
      flagKey: "a",
      q: "evse",
    });
    expect(reason(() => parseAuditQuery({ limit: "0" }))).toMatch(/"limit" must be a whole number from 1 to 200/);
    expect(reason(() => parseAuditQuery({ limit: "500" }))).toMatch(/"limit"/);
    expect(reason(() => parseAuditQuery({ action: "deleted" }))).toMatch(/"action" must be one of/);
    expect(reason(() => parseAuditQuery({ before: "garbage" }))).toMatch(/not a cursor/);
    expect(reason(() => parseAuditQuery({ flagKey: ["a", "b"] }))).toMatch(/only once/);
    expect(reason(() => parseAuditQuery({ page: "2" }))).toBe("Unknown field: page.");
  });

  it("reads back the cursor it hands out", () => {
    const cursor = { timestamp: new Date("2026-10-26T10:00:00.000Z"), seq: 42 };
    expect(parseAuditQuery({ before: encodeAuditCursor(cursor) }).before).toEqual(cursor);
  });
});

describe("parseFlagPatch: notify", () => {
  it("takes notify as true or false only", () => {
    expect(parseFlagPatch({ notify: true })).toEqual({ notify: true });
    expect(reason(() => parseFlagPatch({ notify: "yes" }))).toMatch(/"notify" must be true or false/);
  });
});
