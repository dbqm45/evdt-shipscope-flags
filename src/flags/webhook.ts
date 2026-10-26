import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

// The notification webhook is a URL that users type in and the server then calls. Without limits that lets anyone
// who can reach Settings make the server send requests into its own network (SSRF). So a webhook must be https, must
// not carry credentials, and must not resolve to a private, loopback or link-local address, checked again before every
// send (DNS can change). NOTIFY_WEBHOOK_HOSTS (comma-separated) narrows the allowed hosts; a host listed there may also
// be internal, e.g. a self-hosted chat server.

const PRIVATE = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  PRIVATE.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const)
  PRIVATE.addSubnet(net, prefix, "ipv6");

export class WebhookUrlError extends Error {}

export type Lookup = (hostname: string) => Promise<{ address: string; family: number }[]>;
const systemLookup: Lookup = (hostname) => lookup(hostname, { all: true, verbatim: true });

/** Hosts from NOTIFY_WEBHOOK_HOSTS; empty = any public host. */
export function allowedHosts(env = process.env.NOTIFY_WEBHOOK_HOSTS): string[] {
  return (env ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

function isPrivate(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address); // IPv4-mapped IPv6
  if (mapped) return PRIVATE.check(mapped[1], "ipv4");
  return PRIVATE.check(address, isIP(address) === 6 ? "ipv6" : "ipv4");
}

/** Checks a webhook URL and the addresses its host resolves to; returns the parsed URL or throws WebhookUrlError. */
export async function checkWebhookUrl(raw: string, resolve: Lookup = systemLookup, allowed = allowedHosts()): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new WebhookUrlError("The webhook URL is not a valid URL.");
  }
  if (url.protocol !== "https:") throw new WebhookUrlError("The webhook URL must use https.");
  if (url.username || url.password) throw new WebhookUrlError("The webhook URL must not contain a user name or password.");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (allowed.length && !allowed.includes(host)) throw new WebhookUrlError(`Webhooks may only go to: ${allowed.join(", ")} (NOTIFY_WEBHOOK_HOSTS).`);
  if (allowed.includes(host)) return url; // listed on purpose, internal or not

  const addresses = isIP(host) ? [host] : (await resolve(host).catch(() => [])).map((a) => a.address);
  if (!addresses.length) throw new WebhookUrlError(`The webhook host "${host}" does not resolve.`);
  if (addresses.some(isPrivate)) throw new WebhookUrlError(`The webhook host "${host}" points to a private or local address.`);
  return url;
}

/** Shows enough of a stored webhook to recognise it, without the secret path: "https://hooks.slack.com/…/AbCd". */
export function maskWebhookUrl(raw: string): string {
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return `${url.origin}/…/${raw.slice(-4)}`;
  } catch {
    return "…";
  }
}
