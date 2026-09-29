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
        {mission?.sampling && (
          <div
            style={{
              background: "rgba(2, 132, 199, 0.12)",
              border: "1px solid #0284c7",
              borderRadius: "var(--radius)",
              padding: "9px 12px",
              display: "flex",
              alignItems: "center",
              gap: 10,
              boxShadow: "0 2px 8px rgba(2, 132, 199, 0.15)",
            }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: "#0284c7",
                display: "inline-block",
                boxShadow: "0 0 0 4px rgba(2, 132, 199, 0.3)",
              }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 12, color: "#0284c7", display: "flex", alignItems: "center", gap: 6 }}>
                <span>ĐANG LẤY MẪU</span>
              </div>
              <div style={{ fontSize: 11, color: "var(--text-2)", marginTop: 1 }}>
                {mission.sampling_message || `Đang lấy mẫu tại WP#${mission.current_waypoint}`}
              </div>
            </div>
          </div>
        )}
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
