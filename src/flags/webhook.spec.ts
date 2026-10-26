import { allowedHosts, checkWebhookUrl, maskWebhookUrl, WebhookUrlError, type Lookup } from "./webhook.js";

const resolvesTo =
  (...addresses: string[]): Lookup =>
  async () =>
    addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));

describe("checkWebhookUrl", () => {
  it("accepts an https URL on a public host", async () => {
    const url = await checkWebhookUrl("https://hooks.slack.com/services/T0/B0/x", resolvesTo("52.0.0.10"), []);
    expect(url.hostname).toBe("hooks.slack.com");
  });

  it.each([
    ["not a url", resolvesTo("52.0.0.10"), /not a valid URL/],
    ["http://hooks.slack.com/x", resolvesTo("52.0.0.10"), /must use https/],
    ["https://user:pass@hooks.slack.com/x", resolvesTo("52.0.0.10"), /user name or password/],
    ["https://metadata.internal/x", resolvesTo("169.254.169.254"), /private or local/],
    ["https://intranet.example/x", resolvesTo("52.0.0.10", "192.168.1.20"), /private or local/],
    ["https://127.0.0.1/x", resolvesTo(), /private or local/],
    ["https://[::1]/x", resolvesTo(), /private or local/],
    ["https://mapped.example/x", resolvesTo("::ffff:10.1.2.3"), /private or local/],
    ["https://nowhere.example/x", resolvesTo(), /does not resolve/],
  ])("refuses %s", async (raw, lookup, reason) => {
    await expect(checkWebhookUrl(raw, lookup, [])).rejects.toThrow(reason);
    await expect(checkWebhookUrl(raw, lookup, [])).rejects.toBeInstanceOf(WebhookUrlError);
  });

  it("limits hosts to NOTIFY_WEBHOOK_HOSTS, where a listed host may be internal", async () => {
    const allowed = allowedHosts(" Chat.Internal.example , hooks.slack.com ");
    expect(allowed).toEqual(["chat.internal.example", "hooks.slack.com"]);
    await expect(checkWebhookUrl("https://other.example/x", resolvesTo("52.0.0.10"), allowed)).rejects.toThrow(/may only go to/);
    await expect(checkWebhookUrl("https://chat.internal.example/hook", resolvesTo("10.0.0.5"), allowed)).resolves.toBeInstanceOf(URL);
  });
});

describe("maskWebhookUrl", () => {
  it("keeps the origin and the last four characters only", () => {
    expect(maskWebhookUrl("https://hooks.slack.com/services/T0/B0/AbCdEfGh")).toBe("https://hooks.slack.com/…/EfGh");
    expect(maskWebhookUrl("")).toBe("");
    expect(maskWebhookUrl("garbage")).toBe("…");
  });
});
