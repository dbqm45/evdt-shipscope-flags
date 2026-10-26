import { useState } from "react";
import { IconMoon, IconSun } from "../icons";

type Theme = "dark" | "light";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.dataset.theme === "light" ? "light" : "dark"));

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("shipscope-theme", next);
    } catch {
      /* storage unavailable — theme still applies for this session */
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      className="flex h-9 w-9 items-center justify-center rounded-xl border border-ink-600 bg-ink-850 text-mist-300 transition-colors hover:text-mist-100"
    >
      {theme === "dark" ? <IconMoon width={16} height={16} /> : <IconSun width={16} height={16} />}
    </button>
  );
}
