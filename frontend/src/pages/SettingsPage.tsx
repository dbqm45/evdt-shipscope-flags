import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useStore } from "../state/store";
import { canEditFlags } from "../lib/permissions";
import { Toggle } from "../components/common/Toggle";

export function SettingsPage() {
  const { role } = useStore();
  const editable = canEditFlags(role);
  const [enabled, setEnabled] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getNotifications().then((s) => {
      setEnabled(s.enabled);
      setWebhookUrl(s.webhookUrl);
    });
  }, []);

  async function save(nextEnabled = enabled) {
    if (nextEnabled && !/^https?:\/\//.test(webhookUrl.trim())) {
      setMessage({ tone: "error", text: "Enter a valid http(s) webhook URL first." });
      return;
    }
    setBusy(true);
    const saved = await api.saveNotifications({ enabled: nextEnabled, webhookUrl: webhookUrl.trim() });
    setEnabled(saved.enabled);
    setWebhookUrl(saved.webhookUrl);
    setBusy(false);
    setMessage({ tone: "ok", text: "Saved." });
  }

  async function sendTest() {
    setBusy(true);
    const result = await api.testNotification();
    setBusy(false);
    setMessage(result.ok ? { tone: "ok", text: "Test message sent." } : { tone: "error", text: `Could not send: ${result.error ?? "unknown error"}` });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-mist-100">Settings</h1>
        <p className="mt-1 text-sm text-mist-500">Get told the moment a flag changes in production.</p>
      </div>

      <section className="max-w-2xl space-y-4 rounded-3xl border border-ink-600 bg-ink-850 p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-mist-100">Production change notifications</h2>
            <p className="mt-1 text-xs text-mist-500">
              Sends a message to a Slack-compatible webhook whenever a flag is turned on or off in prod. Sent by the API, so it also covers changes made outside this screen.
            </p>
          </div>
          <Toggle
            checked={enabled}
            disabled={!editable || busy}
            onClick={() => {
              const next = !enabled;
              setEnabled(next);
              void save(next);
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
