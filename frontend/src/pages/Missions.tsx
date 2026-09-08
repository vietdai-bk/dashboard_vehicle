import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ConfirmDialog, type ConfirmProps } from "../components/ConfirmDialog";
import { describeError } from "../components/ControlPanel";
import { MissionStatusBadge } from "../components/StatusPill";
import { useStore } from "../hooks/useStore";
import { toast } from "../hooks/useToast";
import { api } from "../services/api";
import { setState } from "../stores/store";
import type { SavedMission } from "../types";

const fmtTime = (t: number) => new Date(t * 1000).toLocaleString([], { hour12: false });
const fmtDur = (s: number) => `${Math.floor(s / 60)}m ${Math.round(s % 60).toString().padStart(2, "0")}s`;

export function MissionsPage() {
  const history = useStore((s) => s.history);
  const mission = useStore((s) => s.mission);
  const [saved, setSaved] = useState<SavedMission[]>([]);
  const [confirm, setConfirm] = useState<ConfirmProps | null>(null);
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
                {history.map((h) => (
                  <tr key={h.id}>
                    <td className="mono">{fmtTime(h.started_at)}</td>
                    <td>{h.name}</td>
                    <td><MissionStatusBadge status={h.status} /></td>
                    <td className="num">{h.waypoints_completed}/{h.waypoints_total}</td>
                    <td className="num">{fmtDur(h.duration_s)}</td>
                    <td className="num">{h.distance_m >= 1000 ? `${(h.distance_m / 1000).toFixed(2)} km` : `${h.distance_m.toFixed(0)} m`}</td>
                    <td className="num">{h.battery_start.toFixed(0)}% → {h.battery_end.toFixed(0)}%</td>
                    <td style={{ textAlign: "right" }}>
                      <button className="btn xs" disabled={!h.track.length} onClick={() => { setState({ historyTrack: h.track }); nav("/maps"); }}>View track</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      {confirm && <ConfirmDialog {...confirm} />}
    </div>
  );
}
