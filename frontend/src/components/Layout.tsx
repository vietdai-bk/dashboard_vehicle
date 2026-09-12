import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useStore } from "../hooks/useStore";
import { auth } from "../services/auth";
import { IconCamera, IconChart, IconList, IconLog, IconMap, IconSettings } from "./icons";
import { ConnectionPill, VehicleStateBadge } from "./StatusPill";
import { Toasts } from "./Toasts";

const NAV = [
  { to: "/maps", label: "MAPS", icon: IconMap },
  { to: "/camera", label: "CAMERA", icon: IconCamera },
  { to: "/telemetry", label: "TELEMETRY", icon: IconChart },
  { to: "/missions", label: "MISSIONS", icon: IconList },
  { to: "/logs", label: "LOGS", icon: IconLog },
  { to: "/settings", label: "SETTINGS", icon: IconSettings },
];

export function Layout() {
  const activeAlerts = useStore((s) => s.alerts.filter((a) => a.active && !a.acknowledged).length);
  const settings = useStore((s) => s.settings);
  const [clock, setClock] = useState(new Date());
  useEffect(() => { const t = window.setInterval(() => setClock(new Date()), 1000); return () => window.clearInterval(t); }, []);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">GC</span>
          <span className="brand-text">Ground Control<small>{settings?.vehicle_name ?? "VEHICLE DASHBOARD"}</small></span>
        </div>
        <nav className="nav" aria-label="Main">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={({ isActive }) => (isActive ? "active" : "")}>
              <Icon /><span>{label}</span>
              {to === "/logs" && activeAlerts > 0 && <span className="badge danger">{activeAlerts}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span>USER <b>{auth.username ?? "guest"}</b></span>
          <span>v1.0.0</span>
        </div>
      </aside>
      <header className="topbar">
        <span className="title">GROUND CONTROL STATION</span>
        <VehicleStateBadge />
        <span className="spacer" />
        {activeAlerts > 0 && <NavLink to="/logs" className="badge danger">{activeAlerts} ALERT{activeAlerts > 1 ? "S" : ""}</NavLink>}
        <ConnectionPill />
        <span className="clock">{clock.toLocaleTimeString([], { hour12: false })}</span>
      </header>
      <main className="content"><Outlet /></main>
      <Toasts />
    </div>
  );
}
