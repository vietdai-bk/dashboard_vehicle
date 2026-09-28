import { useEffect, useMemo, useState } from "react";
import { IconDownload } from "../components/icons";
import { LineChart, type Series } from "../components/LineChart";
import { useStore } from "../hooks/useStore";
import { toast } from "../hooks/useToast";
import { api } from "../services/api";
import { setState } from "../stores/store";
import { SENSORS, type SensorDef, type Telemetry } from "../types";

const RANGES: { label: string; s: number }[] = [
  { label: "1 min", s: 60 }, { label: "5 min", s: 300 }, { label: "15 min", s: 900 }, { label: "1 hour", s: 3600 },
];
const COLORS = ["#1a4d8f", "#157a3a", "#b25e00", "#b42318", "#5b21b6", "#0e7490"];

function SensorCard({ def, telemetry, history, stale }: { def: SensorDef; telemetry: Telemetry; history: Telemetry[]; stale: boolean }) {
  const v = telemetry[def.key];
  const warn = def.warn ? v < def.warn[0] || v > def.warn[1] : false;
  const series = useMemo<Series[]>(() => [{ label: def.label, color: warn ? "#b25e00" : "#1a4d8f", points: history.map((h) => ({ t: h.timestamp, v: h[def.key] })) }], [history, def, warn]);
  const ago = telemetry.timestamp ? Math.max(0, Math.round(Date.now() / 1000 - telemetry.timestamp)) : null;
  return (
    <div className={`sensor-card ${warn ? "warn" : ""} ${stale ? "stale" : ""}`}>
      <div>
        <div className="name">{def.label.toUpperCase()}</div>
        <div className="value">{v.toFixed(def.decimals)}<span className="u">{def.unit}</span></div>
        <div className="meta">
          <span className={`badge ${stale ? "danger" : warn ? "warn" : "ok"}`}>{stale ? "STALE" : warn ? "WARN" : "OK"}</span>
          <span>{ago === null ? "no data" : ago <= 1 ? "just now" : `${ago}s ago`}</span>
        </div>
      </div>
      <LineChart series={series} windowS={120} height={34} sparkline />
    </div>
  );
}

export function TelemetryPage() {
  const telemetry = useStore((s) => s.telemetry);
  const history = useStore((s) => s.sensorHistory);
  const connected = useStore((s) => s.vehicle.connected);
  const [range, setRange] = useState(300);
  const [now, setNow] = useState(Date.now());
  const [exporting, setExporting] = useState(false);

  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t); }, []);
  // backfill lịch sử từ server khi mở page (nếu store chưa có)
  useEffect(() => {
    if (history.length > 10) return;
    api.telemetry.history(3600).then((h) => h.length && setState((s) => ({ sensorHistory: h.length > s.sensorHistory.length ? h : s.sensorHistory }))).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stale = !connected || !telemetry.timestamp || now / 1000 - telemetry.timestamp > 10;
  const mk = (keys: (keyof Telemetry)[]): Series[] =>
    keys.map((k, i) => ({ label: SENSORS.find((s) => s.key === k)?.label ?? String(k), color: COLORS[i % COLORS.length]!, points: history.map((h) => ({ t: h.timestamp, v: h[k] })) }));
  const charts = useMemo(() => [
    { title: "TEMPERATURE", unit: "°C", series: mk(["temperature"]) },
    { title: "HUMIDITY", unit: "%", series: mk(["humidity"]) },
    { title: "AIR QUALITY INDEX", unit: "", series: mk(["aqi"]) },
    { title: "GASES (CO₂ / CO)", unit: "ppm", series: mk(["co2", "co"]) },
    { title: "GASES (TVOC / NOx)", unit: "ppb", series: mk(["tvoc", "nox"]) },
    { title: "PARTICULATES", unit: "µg/m³", series: mk(["pm25"]) },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [history]);

  const handleExportCsv = async () => {
    try {
      setExporting(true);
      let data: Telemetry[] = [];
      try {
        data = await api.telemetry.history(range);
      } catch {
        data = [];
      }
      if (!data || data.length === 0) {
        const minTime = Date.now() / 1000 - range;
        data = history.filter((h) => h.timestamp >= minTime);
      }
      if (data.length === 0) {
        toast("warning", "Không có dữ liệu telemetry trong khoảng thời gian đã chọn");
        return;
      }
      data = [...data].sort((a, b) => a.timestamp - b.timestamp);

      const headers = [
        "Timestamp",
        "DateTime_UTC",
        "DateTime_Local",
        "AQI",
        "PM2.5 (ug/m3)",
        "CO2 (ppm)",
        "CO (ppm)",
        "TVOC (ppb)",
        "NOx (index)",
        "Temperature (C)",
        "Humidity (%)",
      ];

      const rows = data.map((d) => {
        const dt = new Date(d.timestamp * 1000);
        return [
          d.timestamp.toFixed(2),
          `"${dt.toISOString()}"`,
          `"${dt.toLocaleString()}"`,
          d.aqi != null ? d.aqi.toFixed(1) : "",
          d.pm25 != null ? d.pm25.toFixed(1) : "",
          d.co2 != null ? d.co2.toFixed(1) : "",
          d.co != null ? d.co.toFixed(2) : "",
          d.tvoc != null ? d.tvoc.toFixed(1) : "",
          d.nox != null ? d.nox.toFixed(1) : "",
          d.temperature != null ? d.temperature.toFixed(1) : "",
          d.humidity != null ? d.humidity.toFixed(1) : "",
        ].join(",");
      });

      const csvContent = "\uFEFF" + [headers.join(","), ...rows].join("\r\n");
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const rangeObj = RANGES.find((r) => r.s === range);
      const currentRangeLabel = rangeObj ? rangeObj.label.replace(/\s+/g, "_") : `${range}s`;
      const a = document.createElement("a");
      a.href = url;
      a.download = `telemetry_${currentRangeLabel}_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast("success", `Đã xuất ${data.length} mẫu dữ liệu (${rangeObj?.label ?? ""})`);
    } catch (err) {
      toast("error", `Lỗi xuất file CSV: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExporting(false);
    }
  };

  const groups: { key: SensorDef["group"]; label: string }[] = [
    { key: "environment", label: "ENVIRONMENT" }, { key: "air", label: "AIR QUALITY" },
  ];

  return (
    <div className="page stack">
      {groups.map((g) => (
        <section key={g.key} className="stack" style={{ gap: 8 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="label">{g.label}</span>
            {g.key === "environment" && <span className="muted small">{history.length} samples buffered (max 3600)</span>}
          </div>
          <div className="sensor-grid">
            {SENSORS.filter((s) => s.group === g.key).map((def) => <SensorCard key={def.key} def={def} telemetry={telemetry} history={history} stale={stale} />)}
          </div>
        </section>
      ))}
      <section className="stack" style={{ gap: 8 }}>
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <span className="label">REALTIME CHARTS</span>
          <div className="row" style={{ gap: 10, alignItems: "center" }}>
            <button
              className="btn sm"
              onClick={() => void handleExportCsv()}
              disabled={exporting}
              title={`Xuất dữ liệu telemetry trong ${RANGES.find((r) => r.s === range)?.label ?? ""} ra file CSV`}
            >
              <IconDownload width={14} height={14} /> {exporting ? "Đang xuất..." : `Xuất CSV (${RANGES.find((r) => r.s === range)?.label ?? ""})`}
            </button>
            <div className="range-tabs" role="tablist">
              {RANGES.map((r) => <button key={r.s} role="tab" aria-selected={range === r.s} className={range === r.s ? "active" : ""} onClick={() => setRange(r.s)}>{r.label}</button>)}
            </div>
          </div>
        </div>
        <div className="chart-grid">
          {charts.map((c) => (
            <div key={c.title} className="card chart-card">
              <div className="card-h">{c.title}
                <span className="legend">{c.series.map((s) => <span key={s.label}><i style={{ background: s.color }} />{s.label}</span>)}</span>
              </div>
              <div className="card-b tight"><LineChart series={c.series} windowS={range} unit={c.unit} height={200} /></div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
