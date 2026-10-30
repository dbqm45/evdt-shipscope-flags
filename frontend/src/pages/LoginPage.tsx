import { motion } from "framer-motion";
import { api } from "../api/client";
import { IconAlertTriangle, IconBolt } from "../components/icons";

/** What went wrong at the last sign-in (the codes the API's callback sends back), in words. */
const LOGIN_ERRORS: Record<string, string> = {
  denied: "Sign-in was cancelled or refused by the identity provider.",
  "no-role": "Your account has no role in ShipScope Flags. Ask an Admin to grant you access.",
  expired: "The sign-in took too long. Try again.",
  failed: "Sign-in failed. Try again; if it keeps failing, ask an Admin to check the API log.",
  unavailable: "The identity provider is not reachable. Try again in a moment.",
  "session-ended": "Your session has ended. Sign in again.",
};

/**
 * Sign-in through the organisation's identity provider (PRD FR-001): the button sends the browser to the API, which
 * hands over to the provider and comes back with a session. When the API itself is not reachable, the page offers
 * the demo data instead, which needs no sign-in.
 */
export function LoginPage({ demo, error, onOpenDemo }: { demo: boolean; error?: string; onOpenDemo: () => void }) {
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
              <p>{LOGIN_ERRORS[error] ?? error}</p>
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
            </>
          )}
        </div>

        <p className="text-shell mt-6 text-center text-[10px] text-mist-700">5 pilot services · test → qa → prod</p>
      </motion.div>
    </div>
  );
}
