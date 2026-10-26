import { Outlet } from "react-router-dom";
import { TopBar } from "./TopBar";

export function AppShell({ onLogout }: { onLogout: () => void }) {
  return (
    <div className="min-h-screen bg-ink-950 pt-6">
      <div className="min-h-[calc(100vh-1.5rem)] rounded-t-[32px] border border-b-0 border-ink-600 bg-ink-900 px-6 py-8 md:px-12">
        <div className="mx-auto max-w-[1400px] space-y-8">
          <TopBar onLogout={onLogout} />
          <main>
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
