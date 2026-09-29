import { useCallback, useEffect, useState } from "react";
import { ControlPanel, describeError } from "../components/ControlPanel";
import { MissionHistory } from "../components/MissionHistory";
import { MissionSummary } from "../components/MissionSummary";
import { VehicleMap } from "../components/VehicleMap";
import { VehicleStatusPanel } from "../components/VehicleStatusPanel";
import { WaypointList } from "../components/WaypointList";
import { useStore } from "../hooks/useStore";
import { toast } from "../hooks/useToast";
import { api } from "../services/api";
import { setState } from "../stores/store";
import type { Waypoint } from "../types";

export function MapsPage() {
  const mission = useStore((s) => s.mission);
  const vehicle = useStore((s) => s.vehicle);
  const alerts = useStore((s) => s.alerts.filter((a) => a.active));
  const [busy, setBusy] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [selectedWpId, setSelectedWpId] = useState<number | null>(null);
  const active = mission?.status === "RUNNING" || mission?.status === "PAUSED";
  const editable = !active && mission?.status !== "UPLOADING";

  useEffect(() => {
    const t = window.setInterval(() => {
      if (!mission?.started_at) { setElapsed(0); return; }
      const end = mission.ended_at ?? Date.now() / 1000;
      setElapsed(Math.max(0, end - mission.started_at));
    }, 500);
    return () => window.clearInterval(t);
  }, [mission?.started_at, mission?.ended_at]);

  // bỏ overlay track lịch sử khi rời page
  useEffect(() => () => setState({ historyTrack: null, historyWaypoints: null }), []);

  const run = useCallback(async (label: string, fn: () => Promise<unknown>, success?: string) => {
    setBusy(label);
    try {
      await fn();
      if (success) toast("success", success);
    } catch (e) {
      toast("error", `${label}: ${describeError(e)}`);
    } finally {
      setBusy(null);
    }
  }, []);

  const addWaypoint = (lat: number, lon: number) =>
    run("ADD WP", async () => {
      const res = await api.mission.addWaypoint(lat, lon);
      if (res?.mission) setState({ mission: res.mission });
    });
  const moveWaypoint = (id: number, lat: number, lon: number) =>
    run("MOVE WP", async () => {
      const res = await api.mission.updateWaypoint(id, { latitude: lat, longitude: lon });
      if (res?.mission) setState({ mission: res.mission });
    });
  const updateWaypoint = (id: number, patch: Partial<Pick<Waypoint, "latitude" | "longitude" | "altitude" | "name">>) =>
    run("EDIT WP", async () => {
      const res = await api.mission.updateWaypoint(id, patch);
      if (res?.mission) setState({ mission: res.mission });
    });
  const deleteWaypoint = (id: number) =>
    run("DELETE WP", async () => {
      const m = await api.mission.deleteWaypoint(id);
      if (m) setState({ mission: m });
    });
  const reorder = (ids: number[]) =>
    run("REORDER", async () => {
      const m = await api.mission.reorder(ids);
      if (m) setState({ mission: m });
    });

  return (
    <div className="page maps">
      <div className="col mission-col">
        <ControlPanel mission={mission} busy={busy} run={run} />
        <MissionSummary mission={mission} elapsedS={elapsed} />
        <MissionHistory />
      </div>
      <div className="col map-col">
        {Boolean(mission?.sampling || vehicle?.sampling) && (
          <div
            className="alert-banner info"
            style={{
              background: "rgba(2, 132, 199, 0.15)",
              border: "1px solid #0284c7",
              color: "var(--text)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 14px",
              borderRadius: "var(--radius)",
              marginBottom: 8,
              boxShadow: "0 0 12px rgba(2, 132, 199, 0.25)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: "#0284c7",
                  display: "inline-block",
                  boxShadow: "0 0 0 4px rgba(2, 132, 199, 0.35)",
                  animation: "pulse-scale 1.5s infinite ease-in-out",
                }}
              />
              <span style={{ fontWeight: 700, color: "#0284c7" }}>⏳ ĐANG CHỜ LẤY MẪU QUAN TRẮC:</span>
              <span style={{ fontWeight: 600 }}>
                {mission?.sampling_message || vehicle?.sampling_message || `Xe đang dừng 1 phút lấy mẫu tại Waypoint #${mission?.current_waypoint || vehicle?.current_waypoint || 1}...`}
              </span>
            </div>
            {((mission?.sampling_remaining_s ?? vehicle?.sampling_remaining_s) !== undefined &&
              (mission?.sampling_remaining_s ?? vehicle?.sampling_remaining_s)! > 0) && (
              <span className="badge info mono" style={{ fontSize: 13, padding: "4px 12px", fontWeight: 700, background: "#0284c7", color: "#fff" }}>
                Còn {Math.round((mission?.sampling_remaining_s ?? vehicle?.sampling_remaining_s)!)}s
              </span>
            )}
          </div>
        )}
        {alerts.filter((a) => a.key !== "SAMPLING").length > 0 && (
          <div className={`alert-banner ${alerts.filter((a) => a.key !== "SAMPLING").some((a) => a.level === "critical") ? "critical" : "warning"}`}>
            {alerts.filter((a) => a.key !== "SAMPLING")[0]!.message}{alerts.filter((a) => a.key !== "SAMPLING").length > 1 && ` (+${alerts.filter((a) => a.key !== "SAMPLING").length - 1} more)`}
          </div>
        )}
        <div className="map-holder">
          <VehicleMap
            mission={mission}
            editable={editable}
            selectedWaypointId={selectedWpId}
            onMapClick={(la, lo) => void addWaypoint(la, lo)}
            onWaypointMoved={(id, la, lo) => void moveWaypoint(id, la, lo)}
          />
        </div>
        <div className="card waypoints-card">
          <div className="card-h">
            <span>WAYPOINTS {mission?.name ? <span className="muted">({mission.name})</span> : null}</span>
            <span className="muted small">{mission?.waypoints.length ?? 0} points</span>
          </div>
          <div className="card-b tight">
            <WaypointList
              mission={mission}
              editable={editable}
              onSelect={(id) => setSelectedWpId(id)}
              onUpdate={(id, p) => void updateWaypoint(id, p)}
              onDelete={(id) => void deleteWaypoint(id)}
              onReorder={(ids) => void reorder(ids)}
            />
          </div>
        </div>
      </div>
      <div className="col status-col">
        <VehicleStatusPanel />
      </div>
    </div>
  );
}
