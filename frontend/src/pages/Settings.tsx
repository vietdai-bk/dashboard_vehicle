import { useEffect, useState } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { describeError } from "../components/ControlPanel";
import { ConnectionPill } from "../components/StatusPill";
import { useStore } from "../hooks/useStore";
import { toast } from "../hooks/useToast";
import { api } from "../services/api";
import { auth } from "../services/auth";
import { setState } from "../stores/store";
import type { AppSettings, SystemInfo } from "../types";

type Field = { key: keyof AppSettings; label: string; type?: "number" | "text" | "bool" | "select"; hint?: string; options?: string[]; step?: number };

const SECTIONS: { title: string; fields: Field[] }[] = [
  { title: "CONNECTION", fields: [
    { key: "data_source", label: "Data source", type: "select", options: ["mock", "uart"], hint: "mock = simulated STM32; uart = real STM32 via PySerial" },
    { key: "uart_port", label: "UART port", hint: "/dev/ttyUSB0, /dev/ttyAMA0, /dev/serial0…" },
    { key: "uart_baudrate", label: "Baud rate", type: "number" },
    { key: "uart_timeout_s", label: "Link timeout (s)", type: "number", step: 0.5, hint: "No packet for this long ⇒ DISCONNECTED + alert" },
    { key: "telemetry_rate_hz", label: "Telemetry rate (Hz)", type: "number", step: 0.5 },
  ] },
  { title: "VEHICLE & SAFETY", fields: [
    { key: "vehicle_name", label: "Vehicle name" },
    { key: "home_lat", label: "Home latitude", type: "number", step: 0.00001 },
    { key: "home_lon", label: "Home longitude", type: "number", step: 0.00001 },
    { key: "acceptance_radius_m", label: "Waypoint acceptance radius (m)", type: "number", step: 0.5 },
    { key: "battery_warn_pct", label: "Battery warning (%)", type: "number" },
    { key: "battery_critical_pct", label: "Battery critical (%)", type: "number" },
    { key: "geofence_radius_m", label: "Geofence radius (m)", type: "number" },
    { key: "auto_rtl_on_abort", label: "RTL after ABORT", type: "bool" },
  ] },
  { title: "MOCK SIMULATION", fields: [
    { key: "mock_cruise_speed_mps", label: "Cruise speed (m/s)", type: "number", step: 0.5 },
    { key: "mock_turn_rate_dps", label: "Turn rate (°/s)", type: "number" },
    { key: "mock_battery_drain_pct_per_min", label: "Battery drain (%/min)", type: "number", step: 0.1 },
    { key: "mock_initial_battery", label: "Initial battery (%) — applies on reconnect", type: "number" },
  ] },
  { title: "MAP", fields: [
    { key: "map_tiles", label: "Tile URL template", hint: "Use a local tile server for offline use" },
    { key: "map_attribution", label: "Attribution" },
  ] },
];

export function SettingsPage() {
  const settings = useStore((s) => s.settings);
  const connection = useStore((s) => s.connection);
  const [draft, setDraft] = useState<Partial<AppSettings>>({});
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [saving, setSaving] = useState(false);
  const [logoutAsk, setLogoutAsk] = useState(false);

  useEffect(() => {
    const load = () => api.config.system().then(setSystem).catch(() => undefined);
    load();
    const t = window.setInterval(load, 5000);
    return () => window.clearInterval(t);
  }, []);

  if (!settings) return <div className="page"><div className="empty">Loading settings…</div></div>;
  const value = (k: keyof AppSettings) => (k in draft ? draft[k] : settings[k]);
  const dirty = Object.keys(draft).length > 0;

  const save = async () => {
    setSaving(true);
    try {
      const r = await api.config.update(draft);
      setState({ settings: r.settings });
      setDraft({});
      const changed = Object.keys(r.changed);
      toast("success", changed.length ? `Saved: ${changed.join(", ")}` : "No changes");
    } catch (e) { toast("error", describeError(e)); } finally { setSaving(false); }
  };
  const connect = async (source?: string) => {
    setSaving(true);
    try {
      if (dirty) { const r = await api.config.update(draft); setState({ settings: r.settings }); setDraft({}); }
      const c = await api.vehicle.connect(source ?? (value("data_source") as string), value("uart_port") as string, Number(value("uart_baudrate")));
      toast("success", `Connected: ${c.label}`);
    } catch (e) { toast("error", describeError(e)); } finally { setSaving(false); }
  };
  const disconnect = async () => { try { await api.vehicle.disconnect(); toast("info", "Data source stopped"); } catch (e) { toast("error", describeError(e)); } };
  const logout = async () => {
    try { await api.auth.logout(); } catch { /* token có thể đã hết hạn */ }
    auth.clear();
    window.dispatchEvent(new Event("vd:unauthorized"));
  };

  return (
    <div className="page settings">
      {SECTIONS.map((sec) => (
        <div key={sec.title} className="card">
          <div className="card-h">{sec.title}{sec.title === "CONNECTION" && <ConnectionPill />}</div>
          <div className="card-b">
            <div className="form-grid">
              {sec.fields.map((f) => (
                <div key={f.key} className="form-field">
                  <label htmlFor={`f-${f.key}`}>{f.label}</label>
                  {f.type === "bool" ? (
                    <label className="checkbox"><input id={`f-${f.key}`} type="checkbox" checked={Boolean(value(f.key))} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.checked })} /> enabled</label>
                  ) : f.type === "select" ? (
                    <select id={`f-${f.key}`} className="input" value={String(value(f.key))} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}>
                      {f.options?.map((o) => <option key={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input id={`f-${f.key}`} className={`input ${f.type === "number" ? "mono" : ""}`} type={f.type ?? "text"} step={f.step ?? "any"} value={String(value(f.key))}
                      onChange={(e) => setDraft({ ...draft, [f.key]: f.type === "number" ? Number(e.target.value) : e.target.value })} />
                  )}
                  {f.hint && <span className="hint">{f.hint}</span>}
                </div>
              ))}
            </div>
            {sec.title === "CONNECTION" && (
              <div className="row" style={{ marginTop: 12 }}>
                <button className="btn primary" disabled={saving} onClick={() => void connect()}>Apply & reconnect</button>
                <button className="btn" disabled={saving} onClick={() => void disconnect()}>Disconnect</button>
                <span className="muted small">{connection.detail}</span>
              </div>
            )}
          </div>
        </div>
      ))}

      <div className="card">
        <div className="card-h">SYSTEM</div>
        <div className="card-b">
          <dl className="kv" style={{ gridTemplateColumns: "140px 1fr" }}>
            <dt>SERVER IP</dt><dd style={{ textAlign: "left" }}>{system?.server_ip ?? "…"}</dd>
            <dt>SERVER PORT</dt><dd style={{ textAlign: "left" }}>{system?.server_port ?? settings.server_port}</dd>
            <dt>DASHBOARD URL</dt><dd style={{ textAlign: "left" }}>http://{system?.server_ip ?? "…"}:{system?.server_port ?? settings.server_port}/</dd>
            <dt>SOFTWARE VERSION</dt><dd style={{ textAlign: "left" }}>{system?.version ?? "…"}</dd>
            <dt>UPTIME</dt><dd style={{ textAlign: "left" }}>{system ? `${Math.floor(system.uptime_s / 3600)}h ${Math.floor((system.uptime_s % 3600) / 60)}m ${Math.floor(system.uptime_s % 60)}s` : "…"}</dd>
            <dt>WS CLIENTS</dt><dd style={{ textAlign: "left" }}>{system?.ws_clients ?? "…"}</dd>
            <dt>PYTHON</dt><dd style={{ textAlign: "left" }}>{system?.python ?? "…"}</dd>
          </dl>
        </div>
      </div>

      <div className="card">
        <div className="card-h">USER</div>
        <div className="card-b row" style={{ justifyContent: "space-between" }}>
          <div><div className="label">SIGNED IN AS</div><div style={{ fontSize: 16, fontWeight: 700 }}>{auth.username ?? settings.auth_username}</div>
            <div className="muted small">{settings.auth_enabled ? "Authentication enabled" : "Authentication disabled (AUTH_ENABLED=false)"}</div></div>
          <button className="btn danger" onClick={() => setLogoutAsk(true)}>LOGOUT</button>
        </div>
      </div>

      <div className="card" style={{ gridColumn: "1 / -1" }}>
        <div className="card-b row" style={{ justifyContent: "flex-end" }}>
          <span className="muted small">{dirty ? `${Object.keys(draft).length} unsaved change(s)` : "All changes saved"}</span>
          <button className="btn" disabled={!dirty || saving} onClick={() => setDraft({})}>Discard</button>
          <button className="btn primary" disabled={!dirty || saving} onClick={() => void save()}>Save settings</button>
        </div>
      </div>
      {logoutAsk && <ConfirmDialog title="Log out" message="You will be returned to the login screen. The vehicle keeps running." confirmLabel="Logout" danger onCancel={() => setLogoutAsk(false)} onConfirm={() => void logout()} />}
    </div>
  );
}
