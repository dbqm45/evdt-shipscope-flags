import { motion } from "framer-motion";
import { IconAlertTriangle, IconBolt } from "../components/icons";

/**
 * Placeholder until single sign-on exists (PRD FR-001/002): it checks nothing and says so, rather than pretending to
 * sign anyone in. Break-glass access comes with the identity provider.
 */
export function LoginPage({ onLogin }: { onLogin: () => void }) {
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
          <div role="note" className="flex gap-2 rounded-xl border border-signal-warn/40 bg-signal-warn-dim/20 px-3 py-2.5 text-xs text-mist-300">
            <IconAlertTriangle width={14} height={14} className="mt-0.5 shrink-0 text-signal-warn" />
            <p>
              <span className="font-semibold text-signal-warn">Sign-in is not set up yet.</span> Single sign-on and break-glass access come with the identity
              provider. Until then anyone who can open this page can use it and pick any role — keep it on a trusted network.
            </p>
          </div>
          <button
            onClick={onLogin}
            className="text-shell flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-2.5 text-sm font-semibold text-ink-950 transition-opacity hover:opacity-90"
          >
            Open the dashboard
          </button>
        </div>

        <p className="text-shell mt-6 text-center text-[10px] text-mist-700">5 pilot services · test → qa → prod</p>
      </motion.div>
    </div>
  );
}
