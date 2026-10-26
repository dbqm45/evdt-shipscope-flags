import type { ReactNode } from "react";
import clsx from "clsx";

type Tone = "amber" | "on" | "off" | "warn" | "critical" | "info" | "neutral";

const TONE_CLASSES: Record<Tone, string> = {
  amber: "border-signal-warn/40 text-signal-warn bg-signal-warn-dim/30",
  on: "border-signal-on/40 text-signal-on bg-signal-on-dim/30",
  off: "border-ink-500 text-mist-500 bg-ink-800",
  warn: "border-signal-warn/40 text-signal-warn bg-signal-warn-dim/30",
  critical: "border-signal-critical/40 text-signal-critical bg-signal-critical-dim/30",
  info: "border-signal-info/40 text-signal-info bg-signal-info-dim/30",
  neutral: "border-ink-500 text-mist-300 bg-ink-800",
};

export function Badge({ tone = "neutral", children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={clsx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-1.5 py-0.5 text-shell text-[10px] font-medium uppercase tracking-wider leading-none",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
