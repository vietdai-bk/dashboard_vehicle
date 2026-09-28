import { useEffect, useMemo, useState } from "react";
import { IconDownload } from "../components/icons";
import { LineChart, type Series } from "../components/LineChart";
import { useStore } from "../hooks/useStore";
import { toast } from "../hooks/useToast";
import { api } from "../services/api";
import { setState } from "../stores/store";
import { SENSORS, type SensorDef, type Telemetry } from "../types";

import { AQI_SCALE, evaluateCompositeAqi, getAqiInfo } from "../utils/aqi";

const RANGES: { label: string; s: number }[] = [
  { label: "1 min", s: 60 }, { label: "5 min", s: 300 }, { label: "15 min", s: 900 }, { label: "1 hour", s: 3600 },
];
const COLORS = ["#1a4d8f", "#157a3a", "#b25e00", "#b42318", "#5b21b6", "#0e7490"];

function AqiAssessmentCard({ telemetry }: { telemetry: Telemetry }) {
  const [showTable, setShowTable] = useState(false);
  const evaluation = useMemo(() => evaluateCompositeAqi(telemetry), [telemetry]);
  const cat = evaluation.category;

  return (
    <div
      className="card"
      style={{
        border: `1.5px solid ${cat.border}`,
        background: "var(--surface)",
        boxShadow: "0 4px 16px rgba(0,0,0,0.06)",
        overflow: "hidden",
      }}
    >
      <div
        className="card-h"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
          background: cat.bg,
          color: cat.fg,
          borderBottom: `1px solid ${cat.border}`,
          padding: "10px 16px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 18 }}>🛡️</span>
          <span style={{ fontWeight: 800, fontSize: 14, letterSpacing: "0.5px" }}>
            ĐÁNH GIÁ CHẤT LƯỢNG KHÔNG KHÍ TỔNG HỢP (COMPOSITE AQI)
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              background: cat.fg,
              color: "#fff",
              padding: "2px 10px",
              borderRadius: 20,
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            {cat.label} ({cat.colorName})
          </span>
          <button
            type="button"
            className="btn xs"
            onClick={() => setShowTable((v) => !v)}
            style={{ fontSize: 11, padding: "3px 8px", background: "rgba(255,255,255,0.85)", color: cat.fg, fontWeight: 700 }}
          >
            {showTable ? "▲ Thu gọn bảng chuẩn" : "▼ Xem thang AQI chuẩn"}
          </button>
        </div>
      </div>

      <div className="card-b" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
        {/* Hàng chỉ số chính & Khuyến nghị */}
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 16, alignItems: "stretch" }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              background: cat.bg,
              color: cat.fg,
              border: `2px solid ${cat.border}`,
              borderRadius: "var(--radius)",
              padding: "12px 22px",
              minWidth: 130,
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>CHỈ SỐ AQI</span>
            <span style={{ fontSize: 38, fontWeight: 900, lineHeight: 1, margin: "4px 0" }}>{evaluation.aqi.toFixed(0)}</span>
            <span style={{ fontSize: 11.5, fontWeight: 700 }}>{cat.label}</span>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              gap: 6,
              background: "var(--surface-2)",
              padding: "10px 14px",
              borderRadius: "var(--radius)",
              border: "1px solid var(--line)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, fontSize: 12.5, color: "var(--text)" }}>
              <span>🛡️ KHUYẾN NGHỊ HÀNH ĐỘNG BẢO VỆ SỨC KHỎE:</span>
            </div>
            <div style={{ fontSize: 13.5, color: cat.fg, fontWeight: 700, lineHeight: 1.45 }}>
              {cat.recommendation}
            </div>
            {evaluation.primaryPollutant && (
              <div style={{ fontSize: 11.5, color: "var(--text-2)", marginTop: 2 }}>
                Tác nhân ô nhiễm chính: <b style={{ color: "var(--text)" }}>{evaluation.primaryPollutant.name}</b> (nồng độ:{" "}
                <b>{evaluation.primaryPollutant.value} {evaluation.primaryPollutant.unit}</b> → Sub-AQI:{" "}
                <b style={{ color: cat.fg }}>{evaluation.primaryPollutant.subIndex}</b>)
              </div>
            )}
          </div>
        </div>

        {/* Thanh trực quan 6 mức độ */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", height: 10, borderRadius: 5, overflow: "hidden", border: "1px solid var(--line)" }}>
            {AQI_SCALE.map((s) => {
              const active = cat.label === s.label;
              return (
                <div
                  key={s.range}
                  title={`${s.range}: ${s.label}`}
                  style={{
                    flex: 1,
                    background: s.fg,
                    opacity: active ? 1 : 0.28,
                    border: active ? "2px solid #000" : "none",
                    transform: active ? "scaleY(1.3)" : "none",
                    transition: "all 0.2s ease",
                  }}
                />
              );
            })}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text-3)", fontFamily: "var(--mono)" }}>
            <span>0 (Tốt)</span>
            <span>50</span>
            <span>100</span>
            <span>150</span>
            <span>200</span>
            <span>300 (Nguy hiểm)</span>
          </div>
        </div>

        {/* Bảng phân tích chi tiết các cảm biến thành phần */}
        <div style={{ borderTop: "1px dashed var(--line)", paddingTop: 10 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-2)", marginBottom: 8 }}>
            THÔNG SỐ ĐÓNG GÓP TỪ CÁC CẢM BIẾN (TÍNH THEO CHUẨN NỘI SUY EPA / VN-AQI):
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 8 }}>
            {evaluation.pollutants.map((p) => {
              const pCat = getAqiInfo(p.subIndex);
              const isPrimary = evaluation.primaryPollutant?.key === p.key;
              return (
                <div
                  key={p.key}
                  style={{
                    background: isPrimary ? pCat.bg : "var(--surface-2)",
                    border: isPrimary ? `1.5px solid ${pCat.fg}` : "1px solid var(--line)",
                    borderRadius: "var(--radius)",
                    padding: "6px 10px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text)" }}>{p.name}</span>
                    {isPrimary && (
                      <span style={{ fontSize: 9.5, padding: "1px 5px", borderRadius: 3, background: pCat.fg, color: "#fff", fontWeight: 700 }}>
                        CHÍNH
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "var(--mono)", color: "var(--text)" }}>
                      {p.value} <span style={{ fontSize: 10, fontWeight: 400, color: "var(--text-2)" }}>{p.unit}</span>
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: pCat.fg }}>
                      AQI {p.subIndex}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Bảng chuẩn khi bấm mở rộng */}
        {showTable && (
          <div style={{ borderTop: "1px solid var(--line)", paddingTop: 10, overflowX: "auto" }}>
            <table className="table" style={{ fontSize: 11.5 }}>
              <thead>
                <tr>
                  <th style={{ width: 95 }}>Khoảng AQI</th>
                  <th style={{ width: 150 }}>Đánh giá chất lượng</th>
                  <th>🛡️ Khuyến nghị hành động</th>
                </tr>
              </thead>
              <tbody>
                {AQI_SCALE.map((s) => {
                  const isCurrent = cat.label === s.label;
                  return (
                    <tr key={s.range} style={{ background: isCurrent ? s.bg : "transparent" }}>
                      <td style={{ fontWeight: 700, fontFamily: "var(--mono)" }}>{s.range}</td>
                      <td>
                        <span style={{ background: s.bg, color: s.fg, padding: "2px 6px", borderRadius: 3, fontWeight: 700 }}>
                          {s.label} ({s.colorName})
                        </span>
                      </td>
                      <td style={{ color: isCurrent ? s.fg : "inherit", fontWeight: isCurrent ? 700 : 400 }}>
                        {s.recommendation}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

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
      <AqiAssessmentCard telemetry={telemetry} />
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
