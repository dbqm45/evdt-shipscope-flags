import { rateLimits, trustProxy } from "./rate-limit.js";

describe("rateLimits", () => {
  it("defaults to 300 requests a minute for the API and 600 for the consumer endpoint", () => {
    expect(rateLimits({})).toEqual({ api: 300, sdk: 600 });
    expect(rateLimits({ RATE_LIMIT_PER_MINUTE: " 50 ", RATE_LIMIT_SDK_PER_MINUTE: "0" })).toEqual({ api: 50, sdk: 0 });
  });

  it.each(["-1", "1.5", "many"])("refuses %j", (value) => {
    expect(() => rateLimits({ RATE_LIMIT_PER_MINUTE: value })).toThrow(/RATE_LIMIT_PER_MINUTE must be a whole number/);
  });
});

describe("trustProxy", () => {
  it("trusts no proxy unless told to", () => {
    expect(trustProxy(undefined)).toBe(false);
    expect(trustProxy("")).toBe(false);
    expect(trustProxy("false")).toBe(false);
    expect(trustProxy("true")).toBe(true);
    expect(trustProxy("1")).toBe(1);
    expect(trustProxy("loopback, uniquelocal")).toBe("loopback, uniquelocal");
  });
});
