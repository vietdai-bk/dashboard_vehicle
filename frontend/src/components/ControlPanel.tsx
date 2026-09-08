import { useEffect, useState } from "react";
import { api, ApiError } from "../services/api";
import { useStore } from "../hooks/useStore";
import { toast } from "../hooks/useToast";
import type { Mission, SavedMission } from "../types";
import { ConfirmDialog, type ConfirmProps } from "./ConfirmDialog";

interface Props {
  mission: Mission | null;
  busy: string | null;
  run: (label: string, fn: () => Promise<unknown>, success?: string) => Promise<void>;
}

/** ARM / DISARM / UPLOAD / START / PAUSE / RESUME / STOP / ABORT / RTL + save/load mission. */
export function ControlPanel({ mission, busy, run }: Props) {
  const vehicle = useStore((s) => s.vehicle);
  const [confirm, setConfirm] = useState<ConfirmProps | null>(null);
  const [saved, setSaved] = useState<SavedMission[]>([]);
  const [name, setName] = useState(mission?.name ?? "");
  const [loadId, setLoadId] = useState("");

  useEffect(() => { setName(mission?.name ?? ""); }, [mission?.id, mission?.name]);
  const refreshSaved = () => api.mission.saved().then(setSaved).catch(() => undefined);
  useEffect(() => { void refreshSaved(); }, []);

  const wps = mission?.waypoints.length ?? 0;
  const status = mission?.status ?? "EMPTY";
  const active = status === "RUNNING" || status === "PAUSED";
  const connected = vehicle.connected;
  const canStart = connected && vehicle.armed && wps > 0 && mission?.uploaded && !active;
  const startBlocked = !connected ? "Vehicle disconnected" : !vehicle.armed ? "ARM first" : wps === 0 ? "No waypoints" : !mission?.uploaded ? "UPLOAD first" : active ? "Already running" : "";

  const ask = (title: string, message: string, confirmLabel: string, danger: boolean, action: () => Promise<unknown>, ok?: string) =>
    setConfirm({ title, message, confirmLabel, danger, onCancel: () => setConfirm(null),
      onConfirm: () => { setConfirm(null); void run(confirmLabel, action, ok); } });

  const doStart = () => {
    if (!canStart) { toast("warning", `Cannot START: ${startBlocked}`); return; }
    void run("START", () => api.mission.start(), "Mission started");
  };

  const doSave = () => run("SAVE", async () => {
    const m = await api.mission.save(name || undefined);
    await refreshSaved();
    return m;
  }, "Mission saved");
  const doLoad = () => loadId && run("LOAD", () => api.mission.load(loadId), "Mission loaded");
  const doDeleteSaved = () => {
    const target = saved.find((s) => s.id === loadId);
    if (!target) return;
    ask("Delete saved mission", `Delete "${target.name}" permanently?`, "Delete", true, async () => {
      await api.mission.deleteSaved(target.id); setLoadId(""); await refreshSaved();
    }, "Saved mission deleted");
  };

  return (
    <div className="stack">
      <div className="card">
        <div className="card-h">CONTROL</div>
        <div className="card-b stack" style={{ gap: 8 }}>
          <div className="btn-grid">
            <button className="btn warn lg" disabled={!!busy || !connected || vehicle.armed}
              onClick={() => ask("Arm vehicle", "Motors will be enabled. Make sure the area is clear.", "ARM", false, () => api.vehicle.arm(), "Vehicle ARMED")}>ARM</button>
            <button className="btn lg" disabled={!!busy || !connected || !vehicle.armed}
              onClick={() => ask("Disarm vehicle", active ? "Mission is running. It will be STOPPED before disarming." : "Motors will be disabled.", "DISARM", active, () => api.vehicle.disarm(), "Vehicle DISARMED")}>DISARM</button>
          </div>
          <button className="btn primary block lg" disabled={!!busy || !connected || wps === 0 || active || status === "UPLOADING"}
            onClick={() => run("UPLOAD", () => api.mission.upload(), "Mission uploaded — vehicle acknowledged")}>
            {status === "UPLOADING" ? "UPLOADING…" : mission?.uploaded ? "UPLOADED ✓ (re-upload)" : "UPLOAD MISSION"}
          </button>
          <div className="btn-grid">
            {status === "RUNNING"
              ? <button className="btn lg" disabled={!!busy} onClick={() => run("PAUSE", () => api.mission.pause(), "Mission paused")}>PAUSE</button>
              : status === "PAUSED"
                ? <button className="btn ok lg" disabled={!!busy} onClick={() => run("RESUME", () => api.mission.resume(), "Mission resumed")}>RESUME</button>
                : <button className="btn ok lg" disabled={!!busy} onClick={doStart} title={startBlocked}>START</button>}
            <button className="btn danger lg" disabled={!!busy || !active}
              onClick={() => ask("Stop mission", "The vehicle will stop at its current position.", "STOP", true, () => api.mission.stop(), "Mission stopped")}>STOP</button>
          </div>
          <div className="btn-grid">
            <button className="btn sm" disabled={!!busy || !active}
              onClick={() => ask("Abort mission", "Emergency abort: stop immediately. RTL will follow if enabled in Settings.", "ABORT", true, () => api.mission.abort(), "Mission aborted")}>ABORT</button>
            <button className="btn sm" disabled={!!busy || !connected || !vehicle.armed || vehicle.state === "RTL"}
              onClick={() => ask("Return to launch", "Vehicle will navigate back to the home position.", "RTL", false, () => api.vehicle.rtl(), "Returning to launch")}>RTL</button>
          </div>
          {!canStart && !active && <div className="muted small">START requires: {startBlocked || "ready"}</div>}
        </div>
      </div>

      <div className="card">
        <div className="card-h">MISSION FILE</div>
        <div className="card-b stack" style={{ gap: 8 }}>
          <div className="row">
            <input className="input" placeholder="Mission name" value={name} onChange={(e) => setName(e.target.value)} disabled={active} aria-label="Mission name" />
            <button className="btn" disabled={!!busy || wps === 0 || active} onClick={() => void doSave()}>Save</button>
          </div>
          <div className="row">
            <select className="input" value={loadId} onChange={(e) => setLoadId(e.target.value)} disabled={active} aria-label="Saved missions">
              <option value="">Load saved mission…</option>
              {saved.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.waypoints.length} WP)</option>)}
            </select>
            <button className="btn" disabled={!!busy || !loadId || active} onClick={() => void doLoad()}>Load</button>
            <button className="btn ghost sm" disabled={!!busy || !loadId || active} onClick={doDeleteSaved} title="Delete saved">✕</button>
          </div>
          <div className="row">
            <button className="btn sm grow" disabled={!!busy || active} onClick={() => run("NEW", () => api.mission.create(), "New mission")}>New</button>
            <button className="btn sm grow" disabled={!!busy || active || wps === 0}
              onClick={() => ask("Clear all waypoints", `Remove all ${wps} waypoints from the current mission?`, "Clear", true, () => api.mission.clear(), "Waypoints cleared")}>Clear all</button>
          </div>
        </div>
      </div>
      {confirm && <ConfirmDialog {...confirm} />}
    </div>
  );
}

export function describeError(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return e instanceof Error ? e.message : String(e);
}
