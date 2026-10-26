import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { IconX } from "../icons";

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div className="absolute inset-0 bg-ink-950/75 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 360, damping: 30 }}
        className="relative z-10 w-full max-w-md rounded-2xl border border-ink-600 bg-ink-850 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-ink-600 px-5 py-4">
          <h2 className="font-display text-sm font-semibold text-mist-100">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-mist-500 hover:bg-ink-800 hover:text-mist-100">
            <IconX width={16} height={16} />
          </button>
        </div>
        <div className="px-5 py-5">{children}</div>
      </motion.div>
    </div>
  );
}
