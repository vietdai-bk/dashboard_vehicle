import { useStore } from "../hooks/useStore";
import { BatteryGauge } from "./BatteryGauge";
import { Compass } from "./Compass";
import { VehicleStateBadge } from "./StatusPill";

export function VehicleStatusPanel() {
  const v = useStore((s) => s.vehicle);
  const settings = useStore((s) => s.settings);
  const stats = useStore((s) => s.speedStats);
  const avg = stats.n ? stats.sum / stats.n : 0;
  return (
    <div className="stack">
      <div className="card">
        <div className="card-h">VEHICLE <VehicleStateBadge /></div>
        <div className="card-b stack" style={{ gap: 10 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="label">{settings?.vehicle_name ?? "VEHICLE"}</span>
            <span className={`badge ${v.armed ? "warn" : "neutral"}`}>{v.armed ? "ARMED" : "DISARMED"}</span>
          </div>
          {v.error_message && <div className="alert-banner critical">{v.error_message}</div>}
        </div>
      </div>

      <div className="card">
        <div className="card-h">HEADING</div>
        <div className="card-b">
          <Compass heading={v.heading} />
          <div className="row" style={{ justifyContent: "center", gap: 16, marginTop: 6 }}>
            <span className="field"><span className="k">HEADING</span><span className="v">{v.heading.toFixed(0)}°</span></span>
            <span className="field"><span className="k">SATS</span><span className="v">{v.satellites}</span></span>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-h">BATTERY</div>
        <div className="card-b">
          <BatteryGauge pct={v.battery} voltage={v.voltage} warn={settings?.battery_warn_pct ?? 30} critical={settings?.battery_critical_pct ?? 15} />
        </div>
      </div>

      <div className="card">
        <div className="card-h">SPEED</div>
        <div className="card-b">
          <div className="field"><span className="k">GROUND SPEED</span><span className="v xl">{v.speed.toFixed(1)}<small>km/h</small></span></div>
          <dl className="kv" style={{ marginTop: 8 }}>
            <dt>MAX</dt><dd>{stats.max.toFixed(1)} km/h</dd>
            <dt>AVG</dt><dd>{avg.toFixed(1)} km/h</dd>
            <dt>TRAVELLED</dt><dd>{v.distance_travelled_m >= 1000 ? `${(v.distance_travelled_m / 1000).toFixed(2)} km` : `${v.distance_travelled_m.toFixed(0)} m`}</dd>
          </dl>
        </div>
      </div>

      <div className="card">
        <div className="card-h">POSITION</div>
        <div className="card-b">
          <dl className="kv">
            <dt>LAT</dt><dd>{v.latitude.toFixed(6)}</dd>
            <dt>LON</dt><dd>{v.longitude.toFixed(6)}</dd>
            <dt>ALT</dt><dd>{v.altitude.toFixed(1)} m</dd>
            <dt>WP</dt><dd>{v.current_waypoint ? `${v.current_waypoint} / ${v.total_waypoints}` : "—"}</dd>
          </dl>
        </div>
      </div>
    </div>
  );
}
