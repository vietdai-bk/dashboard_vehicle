import { useEffect, useState, Fragment } from "react";
import { useNavigate } from "react-router-dom";
import { ConfirmDialog, type ConfirmProps } from "../components/ConfirmDialog";
import { describeError } from "../components/ControlPanel";
import { HistoryMapModal } from "../components/HistoryMapModal";
import { MissionStatusBadge } from "../components/StatusPill";
import { getAqiBadge } from "../components/VehicleMap";
import { useStore } from "../hooks/useStore";
import { toast } from "../hooks/useToast";
import { api } from "../services/api";
import { setState } from "../stores/store";
import type { MissionHistoryEntry, SavedMission } from "../types";

const fmtTime = (t: number) => new Date(t * 1000).toLocaleString([], { hour12: false });
const fmtDur = (s: number) => `${Math.floor(s / 60)}m ${Math.round(s % 60).toString().padStart(2, "0")}s`;

export function MissionsPage() {
  const history = useStore((s) => s.history);
  const mission = useStore((s) => s.mission);
  const [saved, setSaved] = useState<SavedMission[]>([]);
  const [confirm, setConfirm] = useState<ConfirmProps | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedHistory, setSelectedHistory] = useState<MissionHistoryEntry | null>(null);
  const nav = useNavigate();
  const active = mission?.status === "RUNNING" || mission?.status === "PAUSED";

  const refresh = () => {
    api.mission.saved().then(setSaved).catch((e) => toast("error", describeError(e)));
    api.mission.history().then((h) => setState({ history: h })).catch((e) => toast("error", describeError(e)));
  };
  useEffect(refresh, []);

  const load = async (id: string) => {
    try { await api.mission.load(id); toast("success", "Mission loaded"); nav("/maps"); } catch (e) { toast("error", describeError(e)); }
  };
  const del = (m: SavedMission) => setConfirm({
    title: "Delete saved mission", message: `Delete "${m.name}" (${m.waypoints.length} waypoints)?`, confirmLabel: "Delete", danger: true,
    onCancel: () => setConfirm(null),
    onConfirm: async () => { setConfirm(null); try { await api.mission.deleteSaved(m.id); refresh(); } catch (e) { toast("error", describeError(e)); } },
  });
  const clearHistory = () => setConfirm({
    title: "Clear mission history", message: "All mission history records will be removed.", confirmLabel: "Clear", danger: true,
    onCancel: () => setConfirm(null),
    onConfirm: async () => { setConfirm(null); try { await api.mission.clearHistory(); setState({ history: [] }); } catch (e) { toast("error", describeError(e)); } },
  });

  const handleViewTrack = (h: MissionHistoryEntry) => {
    setSelectedHistory(h);
  };

  return (
    <div className="page stack">
      <div className="card">
        <div className="card-h">SAVED MISSIONS <span className="muted">{saved.length}</span></div>
        <div className="card-b tight" style={{ overflow: "auto" }}>
          {saved.length === 0 ? <div className="empty">No saved missions. Create waypoints on MAPS and press Save.</div> : (
            <table className="table">
              <thead><tr><th>NAME</th><th>WAYPOINTS</th><th>UPDATED</th><th>ID</th><th /></tr></thead>
              <tbody>
                {saved.map((m) => (
                  <tr key={m.id}>
                    <td><b>{m.name}</b>{mission?.id === m.id && <span className="badge info" style={{ marginLeft: 6 }}>CURRENT</span>}</td>
                    <td className="num">{m.waypoints.length}</td>
                    <td className="mono">{fmtTime(m.updated_at)}</td>
                    <td className="mono muted">{m.id}</td>
                    <td className="row" style={{ justifyContent: "flex-end" }}>
                      <button className="btn sm" disabled={active} onClick={() => void load(m.id)}>Load</button>
                      <button className="btn sm ghost" onClick={() => del(m)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-h">MISSION HISTORY <span className="row"><span className="muted">{history.length}</span>
          <button className="btn xs ghost" disabled={!history.length} onClick={clearHistory}>Clear</button></span></div>
        <div className="card-b tight" style={{ overflow: "auto" }}>
          {history.length === 0 ? <div className="empty">No missions flown yet.</div> : (
            <table className="table">
              <thead><tr><th>STARTED</th><th>NAME</th><th>RESULT</th><th>WP</th><th>DURATION</th><th>DISTANCE</th><th>BATTERY</th><th /></tr></thead>
              <tbody>
                {history.map((h) => {
                  const isExpanded = expandedId === h.id;
                  const wps = h.waypoints ?? [];
                  return (
                    <Fragment key={h.id}>
                      <tr className={isExpanded ? "active" : ""}>
                        <td className="mono">{fmtTime(h.started_at)}</td>
                        <td>{h.name}</td>
                        <td><MissionStatusBadge status={h.status} /></td>
                        <td className="num">{h.waypoints_completed}/{h.waypoints_total}</td>
                        <td className="num">{fmtDur(h.duration_s)}</td>
                        <td className="num">{h.distance_m >= 1000 ? `${(h.distance_m / 1000).toFixed(2)} km` : `${h.distance_m.toFixed(0)} m`}</td>
                        <td className="num">{h.battery_start.toFixed(0)}% → {h.battery_end.toFixed(0)}%</td>
                        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          {wps.length > 0 && (
                            <button
                              className="btn xs ghost"
                              style={{ marginRight: 6 }}
                              onClick={() => setExpandedId(isExpanded ? null : h.id)}
                            >
                              {isExpanded ? "Ẩn WP" : `Xem ${wps.length} WP`}
                            </button>
                          )}
                          <button
                            className="btn xs"
                            disabled={!h.track.length && !wps.length}
                            onClick={() => handleViewTrack(h)}
                          >
                            View track
                          </button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={8} style={{ background: "var(--surface-2)", padding: "12px 16px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                              <span style={{ fontWeight: 700, fontSize: 13 }}>
                                CHI TIẾT THÔNG SỐ ĐO ĐẠC CÁC WAYPOINT ({wps.length} điểm)
                              </span>
                              <button
                                className="btn xs primary"
                                onClick={() => handleViewTrack(h)}
                              >
                                Xem toàn bộ trên Bản đồ
                              </button>
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 8 }}>
                              {wps.map((wp, idx) => {
                                const t = wp.telemetry;
                                const aqi = t?.aqi ?? 55;
                                const badge = getAqiBadge(aqi);
                                const reachedStr = wp.reached_at ? new Date(wp.reached_at * 1000).toLocaleTimeString() : null;
                                return (
                                  <div
                                    key={wp.id || idx}
                                    style={{
                                      background: "var(--surface)",
                                      border: "1px solid var(--line)",
                                      borderRadius: "var(--radius)",
                                      padding: "8px 12px",
                                      fontSize: 12,
                                    }}
                                  >
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--line)", paddingBottom: 4, marginBottom: 6 }}>
                                      <span style={{ fontWeight: 700, color: "var(--text)" }}>
                                        #{idx + 1} {wp.name || `WP${String(idx + 1).padStart(2, "0")}`}
                                      </span>
                                      <span style={{ background: badge.bg, color: badge.fg, padding: "1px 6px", borderRadius: 3, fontWeight: 700, fontSize: 11 }}>
                                        AQI {aqi.toFixed(0)} ({badge.label})
                                      </span>
                                    </div>
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3px 8px", fontSize: 11.5, color: "var(--text-2)" }}>
                                      <div>PM2.5: <b style={{ color: "var(--text)" }}>{(t?.pm25 ?? 18.5).toFixed(1)} µg/m³</b></div>
                                      <div>CO₂: <b style={{ color: "var(--text)" }}>{(t?.co2 ?? 610).toFixed(0)} ppm</b></div>
                                      <div>CO: <b style={{ color: "var(--text)" }}>{(t?.co ?? 2.1).toFixed(2)} ppm</b></div>
                                      <div>TVOC: <b style={{ color: "var(--text)" }}>{(t?.tvoc ?? 120).toFixed(0)} ppb</b></div>
                                      <div>NOx: <b style={{ color: "var(--text)" }}>{(t?.nox ?? 40).toFixed(1)}</b></div>
                                      <div>Nhiệt độ: <b style={{ color: "var(--text)" }}>{(t?.temperature ?? 28.5).toFixed(1)} °C</b></div>
                                      <div>Độ ẩm: <b style={{ color: "var(--text)" }}>{(t?.humidity ?? 68).toFixed(1)} %</b></div>
                                      <div>Thời gian: <b style={{ color: "var(--text)" }}>{reachedStr || "Đã qua"}</b></div>
                                    </div>
                                    <div style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 4, fontFamily: "var(--mono)" }}>
                                      Vị trí: {wp.latitude.toFixed(5)}, {wp.longitude.toFixed(5)}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
      {selectedHistory && (
        <HistoryMapModal
          entry={selectedHistory}
          onClose={() => setSelectedHistory(null)}
        />
      )}
      {confirm && <ConfirmDialog {...confirm} />}
    </div>
  );
}
