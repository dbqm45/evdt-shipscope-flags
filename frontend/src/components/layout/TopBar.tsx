import { useStore } from "../../state/useStore";
import { isStaleCandidate } from "../../lib/businessLogic";
import { ROLE_LABEL } from "../../lib/permissions";
import { RoleSwitcher } from "../common/RoleSwitcher";
import { ThemeToggle } from "../common/ThemeToggle";
import { IconBolt, IconLogOut } from "../icons";
import { NavTabs } from "./NavTabs";

export function TopBar({ onLogout }: { onLogout: () => void }) {
  const { flags, user, role, currentUser, staleThresholdDays } = useStore();
  const staleCount = flags.filter((f) => isStaleCandidate(f, staleThresholdDays)).length;
  const prodOn = flags.filter((f) => f.environments.prod.enabled).length;
  const initials = (user?.name ?? currentUser)
    .split(/[\s.]+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");

  return (
    <header className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-logo-bg text-logo-fg">
            <IconBolt width={18} height={18} />
          </div>
          <div>
            <h1 className="text-2xl leading-tight tracking-tight">
              <span className="font-bold text-mist-100">ShipScope</span>
              <span className="font-light text-mist-500"> — Flags</span>
            </h1>
            <p className="mt-0.5 text-sm text-mist-500">
              Flag registry: status, owner and change history — promotion order <span className="text-shell text-[13px]">test → qa → prod</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Demo mode only; a signed-in user's role comes from the identity provider. */}
          {!user && <RoleSwitcher />}
          <div className="flex items-center gap-2.5 border-l border-ink-600 pl-4">
            <span
              className="text-shell flex h-8 w-8 items-center justify-center rounded-full border border-ink-500 bg-ink-800 text-[11px] font-semibold text-mist-300"
              title={user ? `${user.name} (${user.username})` : currentUser}
            >
              {initials}
            </span>
            {user && (
              <span className="hidden text-right leading-tight sm:block">
                <span className="block text-xs text-mist-100">{user.name}</span>
                <span className="text-shell block text-[10px] uppercase tracking-wider text-mist-500">{ROLE_LABEL[role]}</span>
              </span>
            )}
            <button onClick={onLogout} className="text-mist-500 transition-colors hover:text-signal-critical" title="Sign out">
              <IconLogOut width={16} height={16} />
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-shell inline-flex items-center rounded-full border border-signal-warn/40 bg-signal-warn-dim/25 px-3.5 py-1.5 text-xs text-signal-warn">
          {`${flags.length} flags · ${prodOn} on in prod`}
          {staleCount > 0 ? ` · ${staleCount} to review` : ""}
        </span>
        <ThemeToggle />
      </div>

      <div className="border-t border-ink-600 pt-5">
        <NavTabs />
      </div>
    </header>
  );
}
