import clsx from "clsx";

export function Toggle({
  checked,
  disabled,
  tone = "on",
  onClick,
}: {
  checked: boolean;
  disabled?: boolean;
  tone?: "on" | "warn";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        "relative h-5 w-9 shrink-0 rounded-full border transition-colors",
        disabled && "cursor-not-allowed opacity-40",
        checked
          ? tone === "warn"
            ? "border-signal-warn/50 bg-signal-warn-dim"
            : "border-signal-on/50 bg-signal-on-dim"
          : "border-ink-500 bg-ink-700",
      )}
    >
      <span
        className={clsx(
          "absolute left-0 top-0.5 h-3.5 w-3.5 rounded-full shadow-sm transition-transform",
          checked ? "translate-x-[18px]" : "translate-x-[2px]",
          checked ? (tone === "warn" ? "bg-signal-warn" : "bg-signal-on") : "bg-mist-500",
        )}
      />
    </button>
  );
}