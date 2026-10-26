import { useEffect, useState } from "react";
import { api, failureReason } from "../api/client";
import { useStore } from "../state/useStore";
import { canEditFlags } from "../lib/permissions";
import { Toggle } from "../components/common/Toggle";

/** The stale threshold of rule 1 (PRD FR-006): Admins only; every change is in the audit log. */
function StaleThresholdSection() {
  const { role, staleThresholdDays, setStaleThreshold } = useStore();
  // What the Admin typed; null shows the stored value.
  const [draft, setDraft] = useState<string | null>(null);
  const days = draft ?? String(staleThresholdDays);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const isAdmin = role === "admin";

  async function save() {
    setBusy(true);
    const result = await setStaleThreshold(Number(days));
    setBusy(false);
    if (result.ok) setDraft(null);
    setMessage(result.ok ? { tone: "ok", text: "Saved." } : { tone: "error", text: `Not saved: ${result.reason ?? "unknown error"}` });
  }

  return (
    <section className="max-w-2xl space-y-4 rounded-3xl border border-ink-600 bg-ink-850 p-6">
      <div>
        <h2 className="text-sm font-semibold text-mist-100">Removal candidates</h2>
        <p className="mt-1 text-xs text-mist-500">
          A release flag that has been ON in every environment for longer than this is marked “candidate for removal” and listed under “to clean up”.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs text-mist-300">
          After
          <input
            type="number"
            min={1}
            max={365}
            value={days}
            disabled={!isAdmin || busy}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="Stale threshold in days"
            className="text-shell w-20 rounded-xl border border-ink-500 bg-ink-900 px-3 py-2 text-sm text-mist-100 outline-none focus:border-accent/60 disabled:opacity-60"
          />
          days
        </label>
        <button
          onClick={() => void save()}
          disabled={!isAdmin || busy || days === String(staleThresholdDays)}
          className="text-shell rounded-xl bg-accent px-3.5 py-2 text-xs font-semibold text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          Save
        </button>
        {message && <span className={message.tone === "ok" ? "text-xs text-signal-on" : "text-xs text-signal-critical"}>{message.text}</span>}
      </div>
      {!isAdmin && <p className="text-xs text-mist-500">Only Admins can change it.</p>}
    </section>
  );
}

export function SettingsPage() {
  const { role, demo } = useStore();
  const editable = canEditFlags(role);
  const [enabled, setEnabled] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (demo) return;
    api
      .getNotifications()
      .then((s) => {
        setEnabled(s.enabled);
        setWebhookUrl(s.webhookUrl);
      })
      .catch((err: unknown) => setMessage({ tone: "error", text: `Could not load the settings: ${failureReason(err)}` }));
  }, [demo]);

  /** `previous` is restored when the server refuses (the toggle flips `enabled` before saving). */
  async function save(nextEnabled = enabled, previous = enabled) {
    if (nextEnabled && !/^https:\/\//.test(webhookUrl.trim())) {
      setEnabled(previous);
      setMessage({ tone: "error", text: "Enter a valid https webhook URL first." });
      return;
    }
    if (demo) {
      setEnabled(nextEnabled);
      setMessage({ tone: "ok", text: "Kept in this browser only — the API is not running (demo data)." });
      return;
    }
    setBusy(true);
    try {
      const saved = await api.saveNotifications({ enabled: nextEnabled, webhookUrl: webhookUrl.trim() });
      setEnabled(saved.enabled);
      setWebhookUrl(saved.webhookUrl);
      setMessage({ tone: "ok", text: "Saved." });
    } catch (err) {
      setEnabled(previous);
      setMessage({ tone: "error", text: `Not saved: ${failureReason(err)}` });
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    if (demo) {
      setMessage({ tone: "error", text: "Could not send: the API is not running (demo data)." });
      return;
    }
    setBusy(true);
    try {
      const result = await api.testNotification();
      setMessage(result.ok ? { tone: "ok", text: "Test message sent." } : { tone: "error", text: `Could not send: ${result.error ?? "unknown error"}` });
    } catch (err) {
      setMessage({ tone: "error", text: `Could not send: ${failureReason(err)}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-mist-100">Settings</h1>
        <p className="mt-1 text-sm text-mist-500">Get told the moment a flag changes in production.</p>
      </div>

      <StaleThresholdSection />

      <section className="max-w-2xl space-y-4 rounded-3xl border border-ink-600 bg-ink-850 p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-mist-100">Production change notifications</h2>
            <p className="mt-1 text-xs text-mist-500">
              Sends a message to a Slack-compatible webhook whenever a flag is turned on or off in prod. This switch covers every flag; a single flag can be
              notified about on its own from its panel. Sent by the API, so it also covers changes made outside this screen; a failed message is retried twice
              and then noted in the audit log.
            </p>
          </div>
          <Toggle
            checked={enabled}
            disabled={!editable || busy}
            onClick={() => {
              const next = !enabled;
              setEnabled(next);
              void save(next, enabled);
            }}
          />
        </div>

        <label className="block">
          <span className="text-shell text-[10px] font-semibold uppercase tracking-widest text-mist-700">Webhook URL</span>
          <input
            value={webhookUrl}
            disabled={!editable}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://hooks.slack.com/services/…"
            className="text-shell mt-1.5 w-full rounded-xl border border-ink-500 bg-ink-900 px-3 py-2 text-sm text-mist-100 outline-none placeholder:text-mist-700 focus:border-accent/60 disabled:opacity-60"
          />
          <span className="mt-1.5 block text-[11px] text-mist-700">
            The saved URL is a secret, so only its start and end are shown. Paste a new one to replace it.
          </span>
        </label>

        <div className="flex items-center gap-2">
          <button
            onClick={() => void save()}
            disabled={!editable || busy}
            className="text-shell rounded-xl bg-accent px-3.5 py-2 text-xs font-semibold text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            Save
          </button>
          <button
            onClick={() => void sendTest()}
            disabled={!editable || busy || !webhookUrl}
            className="text-shell rounded-xl border border-ink-500 px-3.5 py-2 text-xs font-semibold text-mist-300 hover:text-mist-100 disabled:opacity-40"
          >
            Send test message
          </button>
          {message && <span className={message.tone === "ok" ? "text-xs text-signal-on" : "text-xs text-signal-critical"}>{message.text}</span>}
        </div>
        {!editable && <p className="text-xs text-mist-500">Only Editors and Admins can change settings.</p>}
      </section>
    </div>
  );
}
