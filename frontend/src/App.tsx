import { useEffect, useState } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { api, ApiError, ApiUnavailableError, onUnauthorized } from "./api/client";
import { StoreProvider } from "./state/store";
import { AppShell } from "./components/layout/AppShell";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { AuditLogPage } from "./pages/AuditLogPage";
import { ServicesPage } from "./pages/ServicesPage";
import { SettingsPage } from "./pages/SettingsPage";
import type { SignedInUser } from "./types";

/**
 * checking: asking the API who is signed in; signed-out: the sign-in page (`demo` when the API is not reachable);
 * signed-in: the dashboard, for `user`, or for nobody in demo mode.
 */
type Session = { state: "checking" } | { state: "signed-out"; demo: boolean; error?: string } | { state: "signed-in"; user: SignedInUser | null };

/** The sign-in error the API's callback put in the address (?login_error=…). */
const readLoginError = () => new URLSearchParams(window.location.search).get("login_error") ?? undefined;

/** Removes ?login_error=… from the address, so a reload does not show it again. */
function clearLoginError() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("login_error")) return;
  params.delete("login_error");
  window.history.replaceState(null, "", `${window.location.pathname}${params.size ? `?${params}` : ""}`);
}

export default function App() {
  const [session, setSession] = useState<Session>({ state: "checking" });
  // Read during render, not in the effect: the effect may run twice (React's StrictMode) and clears the address.
  const [loginError] = useState(readLoginError);

  useEffect(() => {
    onUnauthorized(() => setSession({ state: "signed-out", demo: false, error: "session-ended" }));
    clearLoginError();
    api.me().then(
      (user) => setSession({ state: "signed-in", user }),
      (err: unknown) =>
        setSession({
          state: "signed-out",
          demo: err instanceof ApiUnavailableError,
          error: loginError ?? (err instanceof ApiError && err.status !== 401 ? err.message : undefined),
        }),
    );
  }, [loginError]);

  if (session.state === "checking") return null;
  if (session.state === "signed-out") {
    return <LoginPage demo={session.demo} error={session.error} onOpenDemo={() => setSession({ state: "signed-in", user: null })} />;
  }

  const { user } = session;
  const logout = () => {
    if (!user) return setSession({ state: "signed-out", demo: true });
    // The provider's own sign-out page comes next, so the next sign-in asks for the password again.
    api.logout().then(
      ({ logoutUrl }) => window.location.assign(logoutUrl),
      () => setSession({ state: "signed-out", demo: false }),
    );
  };

  return (
    <StoreProvider user={user}>
      <BrowserRouter>
        <Routes>
          <Route element={<AppShell onLogout={logout} />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/services" element={<ServicesPage />} />
            <Route path="/audit-log" element={<AuditLogPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </StoreProvider>
  );
}
