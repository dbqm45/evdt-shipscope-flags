import { ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { checkSdkToken } from "./sdk-auth.js";

describe("checkSdkToken", () => {
  it("accepts the configured bearer token", () => {
    expect(() => checkSdkToken("Bearer s3cret", "s3cret")).not.toThrow();
  });

  it.each([undefined, "", "s3cret", "Bearer ", "Bearer s3cre", "Bearer s3cret2", "Basic s3cret"])("refuses %j with 401", (header) => {
    expect(() => checkSdkToken(header, "s3cret")).toThrow(UnauthorizedException);
  });

  it("answers 503 when the server has no token, whatever the caller sends", () => {
    expect(() => checkSdkToken("Bearer anything", "")).toThrow(ServiceUnavailableException);
    expect(() => checkSdkToken(undefined, undefined)).toThrow(ServiceUnavailableException);
  });
});
