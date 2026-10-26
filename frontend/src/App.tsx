import { useState } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { StoreProvider } from "./state/store";
import { AppShell } from "./components/layout/AppShell";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { AuditLogPage } from "./pages/AuditLogPage";
import { SettingsPage } from "./pages/SettingsPage";

export default function App() {
  const [authenticated, setAuthenticated] = useState(false);

  if (!authenticated) {
    return <LoginPage onLogin={() => setAuthenticated(true)} />;
  }

  return (
    <StoreProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<AppShell onLogout={() => setAuthenticated(false)} />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/audit-log" element={<AuditLogPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </StoreProvider>
  );
}