import { Outlet } from "react-router-dom";
import { useStore } from "../../state/useStore";
import { TopBar } from "./TopBar";

function DataNotice() {
  const { demo, loadError, user } = useStore();
  if (user?.breakGlass) {
    return (
      <p role="alert" className="rounded-xl border border-signal-critical/50 bg-signal-critical/10 px-4 py-3 text-sm text-signal-critical">
        Break-glass session: Admin access while the identity provider is down. Every change is recorded as “break-glass” and the session ends within an hour —
        sign in with SSO again as soon as the provider is back.
      </p>
    );
  }
  if (loadError) {
    return (
      <p role="alert" className="rounded-xl border border-signal-critical/40 px-4 py-3 text-sm text-signal-critical">
        Could not load data from the API: {loadError}
      </p>
    );
  }
  if (!demo) return null;
  return (
    <p role="status" className="rounded-xl border border-signal-warn/40 px-4 py-3 text-sm text-signal-warn">
      Demo data — the API is not reachable, so changes stay in this browser and are lost on reload.
    </p>
  );
}

export function AppShell({ onLogout }: { onLogout: () => void }) {
  return (
    <div className="min-h-screen bg-ink-950 pt-6">
      <div className="min-h-[calc(100vh-1.5rem)] rounded-t-[32px] border border-b-0 border-ink-600 bg-ink-900 px-6 py-8 md:px-12">
        <div className="mx-auto max-w-[1400px] space-y-8">
          <TopBar onLogout={onLogout} />
          <DataNotice />
          <main>
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
