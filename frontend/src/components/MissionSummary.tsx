import type { Mission } from "../types";
import { MissionStatusBadge } from "./StatusPill";

const fmtDist = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m.toFixed(0)} m`);
const pad2 = (n: number) => String(n).padStart(2, "0");

export function MissionSummary({ mission, elapsedS }: { mission: Mission | null; elapsedS: number }) {
  const total = mission?.waypoints.length ?? 0;
  const completed = mission?.completed ?? 0;
  const current = mission?.current_waypoint ?? 0;
  const active = mission?.status === "RUNNING" || mission?.status === "PAUSED";
  const pct = Math.round((mission?.progress ?? 0) * 100);
  return (
    <div className="card mission-card">
      <div className="card-h">MISSION <MissionStatusBadge status={mission?.status ?? "EMPTY"} /></div>
      <div className="card-b stack" style={{ gap: 10 }}>
        <div className="mission-summary">
          <div className="field"><span className="k">WAYPOINTS</span><span className="v">{pad2(total)}</span></div>
          <div className="field"><span className="k">CURRENT</span><span className="v">{active && current ? `WP${pad2(current)}` : "—"}</span></div>
          <div className="field"><span className="k">COMPLETED</span><span className="v">{pad2(completed)}</span></div>
          <div className="field"><span className="k">REMAINING</span><span className="v">{pad2(Math.max(0, total - completed))}</span></div>
        </div>
        <div>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 4 }}>
            <span className="label">WP {pad2(active ? current : completed)} / {pad2(total)}</span>
            <span className="num">{pct}%</span>
          </div>
          <div className={`progress ${mission?.status === "COMPLETED" ? "ok" : ""}`}><i style={{ width: `${pct}%` }} /></div>
        </div>
        <dl className="kv">
          <dt>DISTANCE REMAINING</dt><dd>{fmtDist(active ? mission?.distance_remaining_m ?? 0 : 0)}</dd>
          <dt>ROUTE LENGTH</dt><dd>{fmtDist(mission?.distance_total_m ?? 0)}</dd>
          <dt>ELAPSED</dt><dd>{active || mission?.status === "COMPLETED" ? `${pad2(Math.floor(elapsedS / 60))}:${pad2(Math.floor(elapsedS % 60))}` : "—"}</dd>
          {mission?.upload_message && <><dt>UPLOAD</dt><dd className="small">{mission.upload_message}</dd></>}
        </dl>
      </div>
    </div>
  );
}
