import clsx from "clsx";

type Tone = "on" | "off" | "warn" | "critical" | "info";

const TONE_COLOR: Record<Tone, string> = {
  on: "text-signal-on",
  off: "text-signal-off",
  warn: "text-signal-warn",
  critical: "text-signal-critical",
  info: "text-signal-info",
};

export function StatusDot({ tone, pulse = false, size = 8 }: { tone: Tone; pulse?: boolean; size?: number }) {
  return (
    <span className={clsx("relative inline-flex items-center justify-center", TONE_COLOR[tone])} style={{ width: size, height: size }}>
      {pulse && <span className="signal-pulse absolute inset-0 rounded-full" />}
      <span className="relative rounded-full" style={{ width: size, height: size, background: "currentColor" }} />
    </span>
  );
}
