import clsx from "clsx";
import { NavLink } from "react-router-dom";

const NAV_ITEMS = [
  { to: "/", label: "Flags", end: true },
  { to: "/audit-log", label: "Audit log" },
  { to: "/settings", label: "Settings" },
];

export function NavTabs() {
  return (
    <nav className="inline-flex items-center gap-1 rounded-full border border-ink-600 bg-ink-850 p-1">
      {NAV_ITEMS.map(({ to, label, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            clsx("rounded-full px-5 py-2 text-sm font-semibold transition-colors", isActive ? "bg-accent text-ink-950" : "text-mist-500 hover:text-mist-100")
          }
        >
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
