import { UnauthorizedException } from "@nestjs/common";
import { hashToken, identifySdkCaller, newServiceToken } from "./sdk-auth.js";

describe("identifySdkCaller", () => {
  const checkout = { id: "svc-checkout", key: "checkout" };
  const findService = async (tokenHash: string) => (tokenHash === hashToken("ssf_checkout") ? checkout : null);

  it("identifies a service by its credential", async () => {
    await expect(identifySdkCaller("Bearer ssf_checkout", findService, "s3cret")).resolves.toEqual({ service: checkout });
  });

  it("accepts the shared SDK_TOKEN when the server has one", async () => {
    await expect(identifySdkCaller("Bearer s3cret", findService, "s3cret")).resolves.toEqual({ shared: true });
  });

  it.each([undefined, "", "s3cret", "Bearer ", "Bearer s3cre", "Bearer s3cret2", "Basic s3cret", "Basic ssf_checkout"])(
    "refuses %j with 401",
    async (header) => {
      await expect(identifySdkCaller(header, findService, "s3cret")).rejects.toThrow(UnauthorizedException);
    },
  );

  it("refuses everything but service credentials when the server has no shared token", async () => {
    await expect(identifySdkCaller("Bearer anything", findService, "")).rejects.toThrow(UnauthorizedException);
    await expect(identifySdkCaller("Bearer ssf_checkout", findService, undefined)).resolves.toEqual({ service: checkout });
  });
});

describe("service credentials", () => {
  it("are random, prefixed and stored only as a SHA-256 digest", () => {
    const a = newServiceToken();
    expect(a).toMatch(/^ssf_[A-Za-z0-9_-]{43}$/);
    expect(newServiceToken()).not.toBe(a);
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(a)).not.toContain(a.slice(4));
  });
});
