import { useState } from "react";
import { motion } from "framer-motion";
import { IconBolt, IconLock } from "../components/icons";

export function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [showBreakGlass, setShowBreakGlass] = useState(false);
  const [authenticating, setAuthenticating] = useState(false);

  function handleSso() {
    setAuthenticating(true);
    setTimeout(onLogin, 650);
  }

  return (
    <div className="grain relative flex min-h-screen items-center justify-center overflow-hidden bg-ink-900">

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative z-10 w-full max-w-sm"
      >
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

        <div className="scan-sweep relative overflow-hidden rounded-2xl border border-ink-600 bg-ink-850 p-6">
          <button
            onClick={handleSso}
            disabled={authenticating}
            className="text-shell flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-2.5 text-sm font-semibold text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-70"
          >
            {authenticating ? "Authenticating…" : "Continue with single sign-on"}
          </button>

          <div className="my-4 flex items-center gap-3">
            <span className="h-px flex-1 bg-ink-600" />
            <span className="text-shell text-[10px] uppercase tracking-widest text-mist-700">or</span>
            <span className="h-px flex-1 bg-ink-600" />
          </div>

          <button
            onClick={() => setShowBreakGlass((v) => !v)}
            className="text-shell flex w-full items-center justify-center gap-1.5 text-[11px] text-mist-500 hover:text-mist-300"
          >
            <IconLock width={12} height={12} />
            Break-glass admin access
          </button>

          {showBreakGlass && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              className="mt-4 space-y-2.5 border-t border-ink-600 pt-4"
            >
              <p className="text-[11px] text-signal-warn">For identity-provider outages only. This attempt is logged.</p>
              <input
                type="text"
                placeholder="Break-glass admin credential"
                className="text-shell w-full rounded-xl border border-ink-500 bg-ink-850 px-3 py-2 text-xs text-mist-100 outline-none placeholder:text-mist-700 focus:border-signal-warn/50"
              />
              <button
                onClick={handleSso}
                className="text-shell w-full rounded-xl border border-signal-warn/40 bg-signal-warn-dim/25 py-2 text-xs font-medium text-signal-warn hover:bg-signal-warn-dim/40"
              >
                Authenticate with fallback credential
              </button>
            </motion.div>
          )}
        </div>

        <p className="text-shell mt-6 text-center text-[10px] text-mist-700">
          5 pilot services · test → qa → prod
        </p>
      </motion.div>
    </div>
  );
}