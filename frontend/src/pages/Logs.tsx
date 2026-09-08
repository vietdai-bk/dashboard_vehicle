import { useEffect, useState } from "react";
import { describeError } from "../components/ControlPanel";
import { useStore } from "../hooks/useStore";
import { toast } from "../hooks/useToast";
import { api } from "../services/api";
import { setState } from "../stores/store";

const fmt = (t: number) => new Date(t * 1000).toLocaleTimeString([], { hour12: false });

export function LogsPage() {
  const events = useStore((s) => s.events);
  const alerts = useStore((s) => s.alerts);
  const [level, setLevel] = useState("ALL");
  const [category, setCategory] = useState("ALL");

  useEffect(() => {
    api.telemetry.events(300).then((e) => setState({ events: e })).catch((e) => toast("error", describeError(e)));
    api.telemetry.alerts().then((a) => setState({ alerts: a })).catch(() => undefined);
  }, []);

  const ack = async (id: number) => { try { await api.telemetry.ackAlert(id); } catch (e) { toast("error", describeError(e)); } };
  const clear = async () => { try { await api.telemetry.clearEvents(); setState({ events: [] }); } catch (e) { toast("error", describeError(e)); } };
  const cats = Array.from(new Set(events.map((e) => e.category)));
  const rows = events.filter((e) => (level === "ALL" || e.level === level) && (category === "ALL" || e.category === category));
  const activeAlerts = alerts.filter((a) => a.active);

  return (
    <div className="page stack">
      <div className="card">
        <div className="card-h">ALERTS <span className="muted">{activeAlerts.length} active</span></div>
        <div className="card-b stack" style={{ gap: 6 }}>
          {alerts.length === 0 && <div className="empty">No alerts.</div>}
          {alerts.map((a) => (
            <div key={a.id} className={`alert-row ${a.level} ${a.active ? "" : "inactive"}`}>
              <span className={`badge ${a.level === "critical" ? "danger" : a.level === "warning" ? "warn" : "info"}`}>{a.level.toUpperCase()}</span>
              <span className="grow">{a.message}</span>
              <span className="mono muted small">{fmt(a.timestamp)}</span>
              {a.active && !a.acknowledged && <button className="btn xs" onClick={() => void ack(a.id)}>ACK</button>}
              {a.acknowledged && <span className="badge neutral">ACKED</span>}
              {!a.active && <span className="badge neutral">CLEARED</span>}
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-h">EVENT LOG
          <span className="row">
            <select className="input sm" style={{ width: 110 }} value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Level">
              {["ALL", "INFO", "WARNING", "ERROR"].map((l) => <option key={l}>{l}</option>)}
            </select>
            <select className="input sm" style={{ width: 120 }} value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
              <option>ALL</option>{cats.map((c) => <option key={c}>{c}</option>)}
            </select>
            <button className="btn xs ghost" onClick={() => void clear()}>Clear</button>
          </span>
        </div>
        <div style={{ maxHeight: "60vh", overflow: "auto" }}>
          {rows.length === 0 && <div className="empty" style={{ margin: 8 }}>No events.</div>}
          {rows.map((e) => (
            <div key={e.id} className={`log-row ${e.level}`}>
              <span className="t">{fmt(e.timestamp)}</span>
              <span className={`badge ${e.level === "ERROR" ? "danger" : e.level === "WARNING" ? "warn" : "neutral"}`}>{e.level}</span>
              <span className="cat mono muted">{e.category}</span>
              <span>{e.message}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
