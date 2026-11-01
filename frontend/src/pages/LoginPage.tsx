import { motion } from "framer-motion";
import { useState } from "react";
import { api, failureReason } from "../api/client";
import { IconAlertTriangle, IconBolt } from "../components/icons";
import { LOGIN_ERRORS } from "../lib/loginErrors";
import type { SignedInUser } from "../types";

const INPUT =
  "text-shell w-full rounded-xl border border-ink-500 bg-ink-900 px-3 py-2 text-sm text-mist-100 outline-none placeholder:text-mist-700 focus:border-accent/60";

/**
 * Emergency Admin sign-in for an identity-provider outage (PRD FR-002): the password from the secrets vault and a
 * reason. The server logs and announces every attempt, so the form says so before anyone uses it.
 */
function BreakGlassForm({ onSignedIn }: { onSignedIn: (user: SignedInUser) => void }) {
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await api.breakGlass(password, reason));
    } catch (err) {
      setError(failureReason(err));
      setBusy(false);
    }
  }

  return (
    <details className="group rounded-xl border border-ink-600 px-3 py-2.5 text-xs text-mist-500">
      <summary className="cursor-pointer select-none text-mist-300">Identity provider down? Emergency access</summary>
      <form
        className="mt-3 space-y-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p>
          Only during an outage of the identity provider. It gives Admin access for one hour; the sign-in, failed attempts and every change are recorded in the
          audit log and announced on the notification channel.
        </p>
        <label className="block">
          <span className="text-shell text-[10px] font-semibold uppercase tracking-widest text-mist-700">Break-glass password</span>
          <input type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} className={`${INPUT} mt-1`} />
        </label>
        <label className="block">
          <span className="text-shell text-[10px] font-semibold uppercase tracking-widest text-mist-700">Reason (kept in the audit log)</span>
          <textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. SSO outage, prod flag must be turned off"
            className={`${INPUT} mt-1 resize-none`}
          />
        </label>
        {error && (
          <p role="alert" className="text-signal-critical">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || !password || reason.trim().length < 10}
          className="text-shell w-full rounded-xl border border-signal-critical/50 py-2 text-xs font-semibold text-signal-critical transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          Sign in with break-glass
        </button>
      </form>
    </details>
  );
}

/**
 * Sign-in through the organisation's identity provider (PRD FR-001): the button sends the browser to the API, which
 * hands over to the provider and comes back with a session. When the API itself is not reachable, the page offers
 * the demo data instead, which needs no sign-in.
 */
export function LoginPage({
  demo,
  error,
  breakGlass = false,
  onOpenDemo,
  onSignedIn,
}: {
  demo: boolean;
  error?: string;
  /** The server has break-glass access set up. */
  breakGlass?: boolean;
  onOpenDemo: () => void;
  onSignedIn?: (user: SignedInUser) => void;
}) {
  return (
    <div className="grain relative flex min-h-screen items-center justify-center overflow-hidden bg-ink-900">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="relative z-10 w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="flex items-center justify-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-logo-bg text-logo-fg">
              <IconBolt width={18} height={18} />
            </div>
            <span className="text-2xl tracking-tight">
              <span className="font-bold text-mist-100">ShipScope</span>
              <span className="font-light text-mist-500"> — Flags</span>
            </span>
          </div>
          <p className="text-shell mt-2 text-[12px] text-mist-500">Flag control · engineering pilot</p>
        </div>

        <div className="space-y-4 rounded-2xl border border-ink-600 bg-ink-850 p-6">
          {error && (
            <div role="alert" className="flex gap-2 rounded-xl border border-signal-critical/40 px-3 py-2.5 text-xs text-mist-300">
              <IconAlertTriangle width={14} height={14} className="mt-0.5 shrink-0 text-signal-critical" />
              <p>{(Object.hasOwn(LOGIN_ERRORS, error) && LOGIN_ERRORS[error]) || error}</p>
            </div>
          )}
          {demo ? (
            <>
              <div role="note" className="flex gap-2 rounded-xl border border-signal-warn/40 bg-signal-warn-dim/20 px-3 py-2.5 text-xs text-mist-300">
                <IconAlertTriangle width={14} height={14} className="mt-0.5 shrink-0 text-signal-warn" />
                <p>
                  <span className="font-semibold text-signal-warn">The API is not reachable.</span> You can look around with demo data; changes stay in this
                  browser and nothing is saved.
                </p>
              </div>
              <button
                onClick={onOpenDemo}
                className="text-shell flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-2.5 text-sm font-semibold text-ink-950 transition-opacity hover:opacity-90"
              >
                Open the demo
              </button>
            </>
          ) : (
            <>
              <p className="text-xs text-mist-500">Sign in with your company account. Your role (Viewer, Editor or Admin) comes from it.</p>
              <a
                href={api.loginUrl}
                className="text-shell flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-2.5 text-sm font-semibold text-ink-950 transition-opacity hover:opacity-90"
              >
                Sign in with SSO
              </a>
              {breakGlass && onSignedIn && <BreakGlassForm onSignedIn={onSignedIn} />}
            </>
          )}
        </div>

        <p className="text-shell mt-6 text-center text-[10px] text-mist-700">5 pilot services · test → qa → prod</p>
      </motion.div>
    </div>
  );
}
