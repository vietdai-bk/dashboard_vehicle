import { useState } from "react";
import { useStore } from "../hooks/useStore";
import { toast } from "../hooks/useToast";
import { api } from "../services/api";
import { setState } from "../stores/store";
import type { MissionHistoryEntry } from "../types";
import { HistoryMapModal } from "./HistoryMapModal";
import { getAqiBadge } from "./VehicleMap";
import { IconTrash, IconRoute } from "./icons";

interface Props {
  onSelectOnMap?: () => void;
}

export function MissionHistory({ onSelectOnMap: _onSelectOnMap }: Props) {
  const history = useStore((s) => s.history);
  const [modalEntry, setModalEntry] = useState<MissionHistoryEntry | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  const handleSelect = (entry: MissionHistoryEntry) => {
    setModalEntry(entry);
  };

  const handleClearAll = async () => {
    if (!window.confirm("Bạn có chắc muốn xóa toàn bộ lịch sử các chặng đã chạy không?")) return;
    try {
      setClearing(true);
      await api.mission.clearHistory();
      setState({ history: [] });
      setModalEntry(null);
      toast("success", "Đã xóa toàn bộ lịch sử chạy");
    } catch (err) {
      toast("error", `Không thể xóa lịch sử: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setClearing(false);
    }
  };

  const fmtTime = (ts: number) => {
    if (!ts) return "";
    const d = new Date(ts * 1000);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
  };

  const fmtDur = (s: number) => {
    if (s < 60) return `${Math.round(s)}s`;
    const m = Math.floor(s / 60);
    const rem = Math.round(s % 60);
    return `${m}p ${rem}s`;
  };

  return (
    <div className="card hist-card">
      <div className="card-h" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <IconRoute width={15} height={15} /> LỊCH SỬ CHẠY
          <span className="muted small">({history.length} chặng)</span>
        </span>
        {history.length > 0 && (
          <button
            className="btn ghost xs"
            onClick={() => void handleClearAll()}
            disabled={clearing}
            title="Xóa tất cả lịch sử"
            style={{ padding: "2px 6px" }}
          >
            <IconTrash width={12} height={12} /> Xóa hết
          </button>
        )}
      </div>

      <div className="card-b tight hist-list" style={{ maxHeight: 320, overflowY: "auto" }}>
        {history.length === 0 ? (
          <div className="empty" style={{ padding: "16px 12px", textAlign: "center", color: "#64748b", fontSize: 13 }}>
            Chưa có chặng nào hoàn thành.<br />
            Khi xe chạy xong nhiệm vụ, chặng và vết đường sẽ được lưu tại đây.
          </div>
        ) : (
          history.map((entry) => {
            const isModalOpen = modalEntry?.id === entry.id;
            const isExpanded = expandedId === entry.id;
            const wps = entry.waypoints ?? [];
            return (
              <div
                key={entry.id}
                className={`hist-item ${isModalOpen ? "selected" : ""}`}
                style={{
                  padding: "8px 10px",
                  borderBottom: "1px solid var(--border, #e2e8f0)",
                  cursor: "pointer",
                  backgroundColor: isModalOpen ? "rgba(139, 92, 246, 0.12)" : "transparent",
                  transition: "background-color 0.15s ease",
                }}
              >
                <div
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}
                  onClick={() => handleSelect(entry)}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                      <span className="truncate">{entry.name || `Nhiệm vụ #${entry.mission_id}`}</span>
                      <span
                        className={`badge ${entry.status === "COMPLETED" ? "ok" : "warn"}`}
                        style={{ fontSize: 10, padding: "1px 5px", textTransform: "uppercase" }}
                      >
                        {entry.status === "COMPLETED" ? "Hoàn thành" : entry.status}
                      </span>
                    </div>
                    <div className="muted small" style={{ fontSize: 11, marginTop: 2 }}>
                      {fmtTime(entry.started_at)} · {fmtDur(entry.duration_s)} · {entry.distance_m.toFixed(0)}m
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 8 }}>
                    <span
                      className="badge neutral mono"
                      style={{ fontSize: 11, padding: "2px 6px" }}
                      title="Số waypoint đã qua"
                    >
                      {entry.waypoints_completed}/{entry.waypoints_total} WP
                    </span>
                    <button
                      className="btn xs primary"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSelect(entry);
                      }}
                      title="Mở bản đồ popup riêng để xem lộ trình và các chốt đo đạc"
                      style={{ padding: "2px 8px", fontSize: 11, borderRadius: 4 }}
                    >
                      Xem track
                    </button>
                  </div>
                </div>

                {/* Nút xem chi tiết các waypoint của chặng */}
                {wps.length > 0 && (
                  <div style={{ marginTop: 4 }}>
                    <button
                      className="btn ghost xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedId(isExpanded ? null : entry.id);
                      }}
                      style={{ fontSize: 11, padding: "1px 4px", color: "#64748b" }}
                    >
                      {isExpanded ? "▲ Ẩn chi tiết WP" : `▼ Xem ${wps.length} điểm waypoint`}
                    </button>

                    {isExpanded && (
                      <div
                        style={{
                          marginTop: 6,
                          padding: "8px 10px",
                          background: "var(--bg-muted, #f8fafc)",
                          borderRadius: 6,
                          border: "1px solid var(--border, #e2e8f0)",
                          fontSize: 11,
                        }}
                      >
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 6 }}>
                          {wps.map((wp, idx) => {
                            const t = wp.telemetry;
                            const aqi = t?.aqi ?? 55;
                            const badge = getAqiBadge(aqi);
                            const reachedStr = wp.reached_at ? new Date(wp.reached_at * 1000).toLocaleTimeString() : null;
                            return (
                              <div
                                key={wp.id || idx}
                                style={{
                                  background: "var(--surface, #fff)",
                                  border: "1px solid var(--line, #e2e8f0)",
                                  borderRadius: 4,
                                  padding: "6px 8px",
                                }}
                              >
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                                  <span style={{ fontWeight: 700, color: "var(--text)" }}>
                                    #{idx + 1} {wp.name || `WP${String(idx + 1).padStart(2, "0")}`}
                                  </span>
                                  <span style={{ background: badge.bg, color: badge.fg, padding: "1px 5px", borderRadius: 3, fontWeight: 700, fontSize: 10.5 }}>
                                    AQI {aqi.toFixed(0)} ({badge.label})
                                  </span>
                                </div>
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 6px", fontSize: 10.5, color: "var(--text-2)" }}>
                                  <div>PM2.5: <b style={{ color: "var(--text)" }}>{(t?.pm25 ?? 18.5).toFixed(1)} µg/m³</b></div>
                                  <div>CO₂: <b style={{ color: "var(--text)" }}>{(t?.co2 ?? 610).toFixed(0)} ppm</b></div>
                                  <div>CO: <b style={{ color: "var(--text)" }}>{(t?.co ?? 2.1).toFixed(2)} ppm</b></div>
                                  <div>TVOC: <b style={{ color: "var(--text)" }}>{(t?.tvoc ?? 120).toFixed(0)} ppb</b></div>
                                  <div>NOx: <b style={{ color: "var(--text)" }}>{(t?.nox ?? 40).toFixed(1)}</b></div>
                                  <div>Nhiệt độ: <b style={{ color: "var(--text)" }}>{(t?.temperature ?? 28.5).toFixed(1)} °C</b></div>
                                  <div>Độ ẩm: <b style={{ color: "var(--text)" }}>{(t?.humidity ?? 68).toFixed(1)} %</b></div>
                                  <div>Thời gian: <b style={{ color: "var(--text)" }}>{reachedStr || "Đã qua"}</b></div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {modalEntry && (
        <HistoryMapModal
          entry={modalEntry}
          onClose={() => setModalEntry(null)}
        />
      )}
    </div>
  );
}
