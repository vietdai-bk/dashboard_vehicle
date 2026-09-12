import { useCallback, useEffect, useState } from "react";
import { ControlPanel, describeError } from "../components/ControlPanel";
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
  useEffect(() => () => setState({ historyTrack: null }), []);

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

  const addWaypoint = (lat: number, lon: number) => run("ADD WP", () => api.mission.addWaypoint(lat, lon));
  const moveWaypoint = (id: number, lat: number, lon: number) => run("MOVE WP", () => api.mission.updateWaypoint(id, { latitude: lat, longitude: lon }));
  const updateWaypoint = (id: number, patch: Partial<Pick<Waypoint, "latitude" | "longitude" | "altitude" | "name">>) =>
    run("EDIT WP", () => api.mission.updateWaypoint(id, patch));
  const deleteWaypoint = (id: number) => run("DELETE WP", () => api.mission.deleteWaypoint(id));
  const reorder = (ids: number[]) => run("REORDER", () => api.mission.reorder(ids));

  return (
    <div className="page maps">
      <div className="col mission-col">
        <ControlPanel mission={mission} busy={busy} run={run} />
        <MissionSummary mission={mission} elapsedS={elapsed} />
      </div>
      <div className="col map-col">
        {alerts.length > 0 && (
          <div className={`alert-banner ${alerts.some((a) => a.level === "critical") ? "critical" : "warning"}`}>
            {alerts[0]!.message}{alerts.length > 1 && ` (+${alerts.length - 1} more)`}
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
