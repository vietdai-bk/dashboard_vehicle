import { useCallback, useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { LoginPage } from "./pages/Login";
import { LogsPage } from "./pages/Logs";
import { MapsPage } from "./pages/Maps";
import { MissionsPage } from "./pages/Missions";
import { SettingsPage } from "./pages/Settings";
import { TelemetryPage } from "./pages/Telemetry";
import { api, onUnauthorized } from "./services/api";
import { auth } from "./services/auth";
import { telemetrySocket } from "./services/ws";
import { setState } from "./stores/store";
import type { AppSettings } from "./types";

type Gate = "checking" | "login" | "app";

export default function App() {
  const [gate, setGate] = useState<Gate>("checking");

  const check = useCallback(async () => {
    try {
      const s = await api.auth.status();
      setGate(!s.auth_enabled || s.authenticated ? "app" : "login");
    } catch {
      // server chưa lên: thử lại
      window.setTimeout(() => void check(), 2000);
    }
  }, []);

  useEffect(() => { void check(); }, [check]);

  useEffect(() => {
    const toLogin = () => { auth.clear(); setGate("login"); };
    const off = onUnauthorized(toLogin);
    window.addEventListener("vd:unauthorized", toLogin);
    return () => { off(); window.removeEventListener("vd:unauthorized", toLogin); };
  }, []);

  // WebSocket + settings chỉ chạy khi đã vào app
  useEffect(() => {
    if (gate !== "app") return;
    telemetrySocket.onSettings = (s) => setState({ settings: s as AppSettings });
    telemetrySocket.start();
    api.config.get().then((c) => setState({ settings: c.settings })).catch(() => undefined);
    api.mission.history().then((h) => setState({ history: h })).catch(() => undefined);
    api.telemetry.events(200).then((e) => setState({ events: e })).catch(() => undefined);
    api.telemetry.alerts().then((a) => setState({ alerts: a })).catch(() => undefined);
    return () => telemetrySocket.stop();
  }, [gate]);

  if (gate === "checking") return <div className="login"><div className="muted">Connecting to server…</div></div>;
  if (gate === "login") return <LoginPage onLogin={() => setGate("app")} />;

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Navigate to="/maps" replace />} />
          <Route path="/maps" element={<MapsPage />} />
          <Route path="/telemetry" element={<TelemetryPage />} />
          <Route path="/missions" element={<MissionsPage />} />
          <Route path="/logs" element={<LogsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/maps" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
