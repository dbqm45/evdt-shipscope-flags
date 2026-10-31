import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { hashBreakGlassPassword } from "./break-glass.mjs";

describe("break-glass:new", () => {
  it("prints a new password and its hash in the format the API reads", () => {
    const out = execFileSync(process.execPath, [fileURLToPath(new URL("./break-glass.mjs", import.meta.url))], { encoding: "utf8" });
    const password = out.match(/^ {2}([\w-]{32})$/m)?.[1];
    const hash = out.match(/BREAK_GLASS_PASSWORD_HASH=(\S+)/)?.[1];
    assert.ok(password, out);
    assert.match(hash ?? "", /^scrypt:32768:8:1:[\w-]{22}:[\w-]{43}$/);
    const salt = Buffer.from(hash.split(":")[4], "base64url");
    assert.equal(hashBreakGlassPassword(password, salt), hash);
  });
});
