import clsx from "clsx";
import { useStore } from "../../state/store";
import { ROLE_LABEL } from "../../lib/permissions";
import type { Role } from "../../types";

const ROLES: Role[] = ["viewer", "editor", "admin"];

export function RoleSwitcher() {
  const { role, setRole } = useStore();

  return (
    <div className="flex items-center gap-2.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-mist-700">Viewing as</span>
      <div className="flex items-center gap-0.5 rounded-full border border-ink-600 bg-ink-850 p-1">
        {ROLES.map((r) => (
          <button
            key={r}
            onClick={() => setRole(r)}
            className={clsx(
              "rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors",
              role === r ? "bg-accent text-ink-950" : "text-mist-500 hover:text-mist-100",
            )}
          >
            {ROLE_LABEL[r]}
          </button>
        ))}
      </div>
    </div>
  );
}
