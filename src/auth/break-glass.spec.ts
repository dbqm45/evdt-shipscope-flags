// @ts-expect-error -- a plain-JS tool script without type declarations
import { hashBreakGlassPassword, newBreakGlassCredential } from "../../scripts/break-glass.mjs";
import { breakGlassHash, parseBreakGlassHash, verifyBreakGlassPassword } from "./break-glass.js";

const make = newBreakGlassCredential as () => { password: string; hash: string };
const hashOf = hashBreakGlassPassword as (password: string, salt?: Buffer) => string;

describe("break-glass password", () => {
  it("accepts the password `npm run break-glass:new` made, and nothing else", async () => {
    const { password, hash } = make();
    expect(password).toMatch(/^[\w-]{32}$/);
    const stored = parseBreakGlassHash(hash);
    expect(await verifyBreakGlassPassword(password, stored)).toBe(true);
    expect(await verifyBreakGlassPassword(`${password}x`, stored)).toBe(false);
    expect(await verifyBreakGlassPassword("", stored)).toBe(false);
  });

  it("hashes with a fresh salt each time", () => {
    expect(hashOf("same password")).not.toBe(hashOf("same password"));
    expect(hashOf("same password", Buffer.alloc(16, 1))).toBe(hashOf("same password", Buffer.alloc(16, 1)));
  });

  it("is off without BREAK_GLASS_PASSWORD_HASH and stops the API on a malformed or weak one", () => {
    expect(breakGlassHash({})).toBeNull();
    expect(breakGlassHash({ BREAK_GLASS_PASSWORD_HASH: " " })).toBeNull();
    const salt = Buffer.alloc(16).toString("base64url");
    const hash = Buffer.alloc(32).toString("base64url");
    expect(() => breakGlassHash({ BREAK_GLASS_PASSWORD_HASH: "s3cret" })).toThrow(/BREAK_GLASS_PASSWORD_HASH must be/);
    expect(() => parseBreakGlassHash(`scrypt:1024:8:1:${salt}:${hash}`)).toThrow(/N ≥ 16384/);
    expect(() => parseBreakGlassHash(`bcrypt:32768:8:1:${salt}:${hash}`)).toThrow();
    expect(parseBreakGlassHash(`scrypt:32768:8:1:${salt}:${hash}`)).toMatchObject({ N: 32768, r: 8, p: 1 });
  });
});
