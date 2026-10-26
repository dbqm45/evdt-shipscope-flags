import { useState } from "react";
import { useStore } from "../state/store";
import { Badge } from "../components/common/Badge";
import type { Service } from "../types";

const INPUT =
  "text-shell w-full rounded-xl border border-ink-500 bg-ink-900 px-3 py-2 text-sm text-mist-100 outline-none placeholder:text-mist-700 focus:border-accent/60 disabled:opacity-60";
const TH = "text-shell px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-mist-700";
const BUTTON = "text-shell rounded-xl border border-ink-500 px-2.5 py-1.5 text-[11px] font-semibold text-mist-300 hover:text-mist-100 disabled:opacity-40";

const dateTime = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** "never", "just now", "12 min ago", "5 h ago", "3 days ago". */
function sinceText(iso: string | undefined, now = Date.now()): string {
  if (!iso) return "never";
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)} h ago`;
  return `${Math.floor(minutes / (24 * 60))} days ago`;
}

function CredentialBadge({ service }: { service: Service }) {
  if (!service.hasCredential) return <Badge tone="critical">no credential</Badge>;
  if (service.credentialStatus === "rotating")
    return (
      <span className="flex flex-col items-start gap-1">
        <Badge tone="warn">rotating</Badge>
        {service.previousCredentialExpiresAt && (
          <span className="text-[11px] text-mist-700">old one works until {dateTime(service.previousCredentialExpiresAt)}</span>
        )}
      </span>
    );
  return <Badge tone="on">active</Badge>;
}

/** The new credential, shown once: the server keeps only its digest. */
function IssuedToken({ serviceKey, token, onDone }: { serviceKey: string; token: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <section role="status" className="space-y-3 rounded-2xl border border-signal-warn/40 bg-signal-warn-dim/20 p-5">
      <div>
        <h2 className="text-sm font-semibold text-mist-100">New credential for {serviceKey}</h2>
        <p className="mt-1 text-xs text-mist-500">
          Copy it now into the service's secret store: it is not shown again. The service sends it as <code>Authorization: Bearer …</code> to{" "}
          <code>GET /api/v1/sdk/flags</code>.
        </p>
      </div>
      <code className="text-shell block break-all rounded-xl border border-ink-500 bg-ink-900 px-3 py-2 text-sm text-mist-100">{token}</code>
      <div className="flex gap-2">
        <button
          className={BUTTON}
          onClick={() =>
            void navigator.clipboard?.writeText(token).then(
              () => setCopied(true),
              () => setCopied(false),
            )
          }
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <button className={BUTTON} onClick={onDone}>
          Done, I have stored it
        </button>
      </div>
    </section>
  );
}

export function ServicesPage() {
  const { services, flags, role, registerService, rotateCredential } = useStore();
  const isAdmin = role === "admin";
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ serviceKey: string; token: string } | null>(null);

  async function run(serviceKey: string, action: () => Promise<{ ok: boolean; reason?: string; token?: string }>) {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (!result.ok || !result.token) {
      setError(result.reason ?? "Nothing was changed.");
      return false;
    }
    setIssued({ serviceKey, token: result.token });
    return true;
  }

  async function register() {
    if (await run(key.trim(), () => registerService(key, name))) {
      setKey("");
      setName("");
    }
  }

  function rotate(service: Service, revokePrevious: boolean) {
    if (revokePrevious && !window.confirm(`Revoke the current credential of ${service.key} now? The service cannot read its flags until it gets the new one.`))
      return;
    void run(service.key, () => rotateCredential(service.id, revokePrevious));
  }

  const flagCount = (serviceId: string) => flags.filter((f) => f.services.some((b) => b.serviceId === serviceId)).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-mist-100">Services</h1>
        <p className="mt-1 text-sm text-mist-500">Services that read flags, each with its own credential. A service sees only the flags assigned to it.</p>
      </div>

      {issued && <IssuedToken {...issued} onDone={() => setIssued(null)} />}

      {isAdmin && (
        <form
          className="flex max-w-3xl flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void register();
          }}
        >
          <label className="min-w-48 flex-1">
            <span className="text-shell text-[10px] font-semibold uppercase tracking-widest text-mist-700">Service key</span>
            <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="evapl-service-frontend" className={`${INPUT} mt-1.5`} />
          </label>
          <label className="min-w-48 flex-1">
            <span className="text-shell text-[10px] font-semibold uppercase tracking-widest text-mist-700">Name (optional)</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="same as the key" className={`${INPUT} mt-1.5`} />
          </label>
          <button
            type="submit"
            disabled={busy || !key.trim()}
            className="text-shell rounded-xl bg-accent px-3.5 py-2 text-xs font-semibold text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            Register service
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="text-xs text-signal-critical">
          {error}
        </p>
      )}

      <div className="overflow-hidden rounded-2xl border border-ink-600 bg-ink-850 shadow-panel">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-ink-600 bg-ink-800/60 text-left">
              <th className={TH}>Service</th>
              <th className={TH}>Flags</th>
              <th className={TH}>Credential</th>
              <th className={TH}>Last rotated</th>
              <th className={TH}>Last check-in</th>
              {isAdmin && <th className={TH} />}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-700/60">
            {services.map((s) => (
              <tr key={s.id} className="hover:bg-ink-800/30">
                <td className="px-4 py-2.5">
                  <p className="text-shell text-xs text-mist-100">{s.key}</p>
                  {s.name !== s.key && <p className="text-xs text-mist-500">{s.name}</p>}
                </td>
                <td className="text-shell px-4 py-2.5 text-xs text-mist-300">{flagCount(s.id)}</td>
                <td className="px-4 py-2.5">
                  <CredentialBadge service={s} />
                </td>
                <td className="text-shell whitespace-nowrap px-4 py-2.5 text-xs text-mist-500">{s.hasCredential ? dateTime(s.credentialLastRotated) : "—"}</td>
                <td className="text-shell whitespace-nowrap px-4 py-2.5 text-xs text-mist-500" title={s.lastCheckInAt && dateTime(s.lastCheckInAt)}>
                  {sinceText(s.lastCheckInAt)}
                </td>
                {isAdmin && (
                  <td className="whitespace-nowrap px-4 py-2.5 text-right">
                    <span className="inline-flex gap-1.5">
                      <button className={BUTTON} disabled={busy} onClick={() => rotate(s, false)}>
                        {s.hasCredential ? "Rotate credential" : "Issue credential"}
                      </button>
                      {s.hasCredential && (
                        <button
                          className={BUTTON}
                          disabled={busy}
                          onClick={() => rotate(s, true)}
                          title="For a leaked credential: the old one stops working at once."
                        >
                          Revoke &amp; reissue
                        </button>
                      )}
                    </span>
                  </td>
                )}
              </tr>
            ))}
            {services.length === 0 && (
              <tr>
                <td colSpan={isAdmin ? 6 : 5} className="px-4 py-8 text-center text-xs text-mist-700">
                  No services registered yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {isAdmin ? (
        <p className="text-xs text-mist-500">
          After a rotation the old credential keeps working for 24 hours, so the service can be redeployed with the new one.
        </p>
      ) : (
        <p className="text-xs text-mist-500">Only Admins can register services and rotate their credentials.</p>
      )}
    </div>
  );
}
