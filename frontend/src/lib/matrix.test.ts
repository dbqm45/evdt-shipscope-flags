import { describe, expect, it } from "vitest";
import { makeBinding, makeFlag, makeService } from "../test/factories";
import { groupByService } from "./matrix";

describe("groupByService", () => {
  it("lists each service with the flags it reads, then the flags no service reads", () => {
    const services = [makeService("svc-api", "orders-api"), makeService("svc-web", "shop-web"), makeService("svc-idle", "idle")];
    const shared = makeFlag({ key: "shared", services: [makeBinding("svc-web"), makeBinding("svc-api", { readMode: "both" })] });
    const webOnly = makeFlag({ key: "web-only", services: [makeBinding("svc-web")] });
    const orphan = makeFlag({ key: "orphan" });

    const groups = groupByService([shared, webOnly, orphan], services);

    expect(groups.map((g) => [g.service?.key, g.rows.map((r) => r.flag.key)])).toEqual([
      ["orders-api", ["shared"]],
      ["shop-web", ["shared", "web-only"]],
      [undefined, ["orphan"]],
    ]);
    expect(groups[0].rows[0].binding?.readMode).toBe("both");
  });
});
