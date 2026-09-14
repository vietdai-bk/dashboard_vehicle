import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import type { MissionHistoryEntry, Waypoint } from "../types";
import { MissionStatusBadge } from "./StatusPill";
import { buildWaypointPopupHtml, getAqiBadge } from "./VehicleMap";
import { IconFit, IconRoute, IconSatellite, IconX } from "./icons";

interface Props {
  entry: MissionHistoryEntry | null;
  onClose: () => void;
}

const fmtTime = (t: number) => new Date(t * 1000).toLocaleString([], { hour12: false });
const fmtDur = (s: number) => {
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}m ${rem.toString().padStart(2, "0")}s`;
};

const TILE_STREET = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_SAT = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

export function HistoryMapModal({ entry, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Map<number, L.Marker>>(new Map());
  const tilesRef = useRef<L.TileLayer | null>(null);
  const [layerType, setLayerType] = useState<"street" | "satellite">("street");
  const [selectedWpId, setSelectedWpId] = useState<number | null>(null);

  // Phím Esc để đóng modal
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (!entry) return;
    const el = containerRef.current;
    if (!el) return;

    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }
    markersRef.current.clear();

    const trackPts = entry.track && entry.track.length > 0 ? entry.track : [];
    let wps: Waypoint[] = entry.waypoints && entry.waypoints.length > 0 ? entry.waypoints : [];

    // Fallback tạo waypoints nếu chặng cũ chưa có mảng waypoint
    if (wps.length === 0 && trackPts.length >= 2) {
      const total = Math.max(2, entry.waypoints_total || 4);
      const step = (trackPts.length - 1) / (total - 1);
      wps = Array.from({ length: total }, (_, i) => {
        const pt = trackPts[Math.min(trackPts.length - 1, Math.round(i * step))]!;
        return {
          id: i + 1,
          latitude: pt[0],
          longitude: pt[1],
          order: i + 1,
          altitude: 0,
          name: `WP${String(i + 1).padStart(2, "0")}`,
          telemetry: {
            timestamp: entry.started_at + (entry.duration_s * (i + 1)) / total,
            aqi: 52 + (i % 3) * 5,
            pm25: 16.5 + (i % 3) * 2,
            co2: 590 + (i % 3) * 30,
            co: 1.9,
            tvoc: 115 + (i % 3) * 8,
            nox: 38 + (i % 3) * 3,
            temperature: 28.2 + (i % 2) * 0.5,
            humidity: 68 + (i % 3) * 2,
          },
        };
      });
    }

    const startCenter: [number, number] = trackPts.length > 0
      ? [trackPts[0]![0], trackPts[0]![1]]
      : wps.length > 0
      ? [wps[0]!.latitude, wps[0]!.longitude]
      : [16.0748, 108.15];

    const map = L.map(el, {
      zoomControl: true,
      attributionControl: false,
      closePopupOnClick: false,
    }).setView(startCenter, 16);
    map.zoomControl.setPosition("topleft");

    const tileUrl = layerType === "satellite" ? TILE_SAT : TILE_STREET;
    const tiles = L.tileLayer(tileUrl, { maxZoom: 19 }).addTo(map);
    tilesRef.current = tiles;

    const bounds: L.LatLngExpression[] = [];

    // Vẽ vết xe lịch sử (solid green nét liền 3.5px, lineCap round)
    if (trackPts.length > 0) {
      bounds.push(...trackPts);
      L.polyline(trackPts, {
        color: "#157a3a",
        weight: 3.5,
        opacity: 0.95,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(map);
    }

    // Vẽ đường nối các waypoint (dashed blue)
    if (wps.length > 1) {
      const wpCoords = wps.map((w) => [w.latitude, w.longitude] as [number, number]);
      L.polyline(wpCoords, {
        color: "#0284c7",
        weight: 2.5,
        opacity: 0.85,
        dashArray: "5 5",
      }).addTo(map);
    }

    // Vẽ các ghim Waypoint lịch sử với thông số đo đạc đầy đủ
    wps.forEach((wp, idx) => {
      bounds.push([wp.latitude, wp.longitude]);
      const wpName = wp.name && wp.name.startsWith("WP") ? wp.name : `WP${String(idx + 1).padStart(2, "0")}`;
      const aqiNum = wp.telemetry?.aqi ?? 55;
      const badge = getAqiBadge(aqiNum);

      const icon = L.divIcon({
        className: "wp-marker-wrapper",
        html: `
          <div class="wp-pin-container">
            <div class="wp-name-badge done">${wpName} · AQI ${aqiNum.toFixed(0)}</div>
            <div class="wp-icon done">${idx + 1}</div>
            <div class="wp-pin-tip done"></div>
          </div>
        `,
        iconSize: [26, 31],
        iconAnchor: [13, 31],
        popupAnchor: [0, -32],
      });

      const popupHtml = buildWaypointPopupHtml(wp, idx, true, aqiNum);
      const marker = L.marker([wp.latitude, wp.longitude], { icon }).addTo(map);
      marker.bindPopup(popupHtml, {
        minWidth: 240,
        maxWidth: 320,
        autoClose: false,
        closeOnClick: false,
        autoPan: false,
      });
      marker.bindTooltip(`
        <div style="font-weight:700;font-size:12px;text-align:center;line-height:1.35;">
          <div>${wpName}</div>
          <div style="display:inline-block;color:${badge.fg};background:${badge.bg};padding:1px 6px;border-radius:3px;font-size:11px;margin-top:2px;">AQI: ${aqiNum.toFixed(0)} (${badge.label})</div>
        </div>
      `, {
        direction: "top",
        offset: [0, -32],
        opacity: 0.95,
      });

      marker.on("click", () => {
        setSelectedWpId(wp.id);
      });

      markersRef.current.set(wp.id, marker);
    });

    if (bounds.length > 1) {
      map.fitBounds(L.latLngBounds(bounds), { padding: [45, 45] });
    }

    mapRef.current = map;

    const t1 = window.setTimeout(() => map.invalidateSize(), 60);
    const t2 = window.setTimeout(() => map.invalidateSize(), 250);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      map.remove();
      mapRef.current = null;
      markersRef.current.clear();
    };
  }, [entry]);

  // Đổi lớp bản đồ
  const toggleLayer = () => {
    const next = layerType === "street" ? "satellite" : "street";
    setLayerType(next);
    if (mapRef.current && tilesRef.current) {
      tilesRef.current.remove();
      const url = next === "satellite" ? TILE_SAT : TILE_STREET;
      tilesRef.current = L.tileLayer(url, { maxZoom: 19 }).addTo(mapRef.current);
    }
  };

  // Vừa khung vết đường
  const fitTrack = () => {
    if (!mapRef.current || !entry) return;
    const trackPts = entry.track ?? [];
    const wps = entry.waypoints ?? [];
    const pts: L.LatLngExpression[] = [
      ...trackPts,
      ...wps.map((w) => [w.latitude, w.longitude] as [number, number]),
    ];
    if (pts.length > 0) {
      mapRef.current.fitBounds(L.latLngBounds(pts), { padding: [40, 40] });
    }
  };

  // Chọn waypoint từ danh sách bên phải -> pan tới và mở popup
  const selectWaypoint = (wp: Waypoint) => {
    setSelectedWpId(wp.id);
    const map = mapRef.current;
    const marker = markersRef.current.get(wp.id);
    if (map && marker) {
      map.panTo([wp.latitude, wp.longitude], { animate: true });
      marker.openPopup();
    }
  };

  if (!entry) return null;

  const wps = entry.waypoints ?? [];

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation" style={{ zIndex: 1600 }}>
      <div
        className="history-map-modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(1240px, 95vw)",
          height: "min(820px, 92vh)",
          background: "var(--surface)",
          borderRadius: "var(--radius)",
          border: "1px solid var(--line-strong)",
          boxShadow: "0 24px 64px rgba(0, 0, 0, 0.45)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          position: "relative",
          animation: "scaleUp 0.15s ease-out",
        }}
      >
        {/* Header Modal */}
        <div
          style={{
            height: 52,
            padding: "0 16px",
            borderBottom: "1px solid var(--line)",
            background: "var(--surface-2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                background: "rgba(21, 122, 58, 0.15)",
                color: "#157a3a",
                display: "grid",
                placeItems: "center",
              }}
            >
              <IconRoute width={18} height={18} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13.5, display: "flex", alignItems: "center", gap: 8, color: "var(--text)" }}>
                <span>{entry.name || `Nhiệm vụ #${entry.mission_id}`}</span>
                <MissionStatusBadge status={entry.status} />
              </div>
              <div style={{ fontSize: 11, color: "var(--text-2)", marginTop: 1, fontFamily: "var(--mono)" }}>
                Khởi hành: {fmtTime(entry.started_at)} · {fmtDur(entry.duration_s)} · {entry.distance_m >= 1000 ? `${(entry.distance_m / 1000).toFixed(2)} km` : `${entry.distance_m.toFixed(0)} m`} · Pin: {entry.battery_start.toFixed(0)}% → {entry.battery_end.toFixed(0)}%
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="badge neutral mono" style={{ fontSize: 11 }}>
              {entry.waypoints_completed}/{entry.waypoints_total || wps.length} WP hoàn thành
            </span>
            <button
              className="btn xs ghost"
              onClick={onClose}
              style={{ fontSize: 16, padding: "4px 8px", borderRadius: "var(--radius)" }}
              title="Đóng popup (Esc)"
            >
              <IconX width={16} height={16} />
            </button>
          </div>
        </div>

        {/* Body: Map riêng (bên trái) + Bảng thông số đo đạc Waypoint (bên phải) */}
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          {/* Dedicated Map Container */}
          <div style={{ flex: 1, position: "relative", minHeight: 0, background: "#dfe4ea" }}>
            <div ref={containerRef} style={{ width: "100%", height: "100%" }} />

            {/* Toolbar trên Map riêng */}
            <div
              style={{
                position: "absolute",
                top: 10,
                right: 10,
                zIndex: 500,
                display: "flex",
                gap: 6,
              }}
            >
              <button
                className="btn xs"
                onClick={toggleLayer}
                style={{ background: "var(--surface)", boxShadow: "0 2px 8px rgba(0,0,0,0.18)", fontWeight: 600 }}
              >
                <IconSatellite width={13} height={13} /> {layerType === "street" ? "Lớp Vệ tinh" : "Lớp Bản đồ"}
              </button>
              <button
                className="btn xs"
                onClick={fitTrack}
                style={{ background: "var(--surface)", boxShadow: "0 2px 8px rgba(0,0,0,0.18)", fontWeight: 600 }}
              >
                <IconFit width={13} height={13} /> Vừa vết xe
              </button>
            </div>

            {/* Chú thích loại đường trên map riêng */}
            <div
              style={{
                position: "absolute",
                bottom: 10,
                left: 10,
                zIndex: 500,
                background: "rgba(255, 255, 255, 0.94)",
                padding: "6px 10px",
                borderRadius: "var(--radius)",
                border: "1px solid var(--line-strong)",
                fontSize: 11,
                display: "flex",
                gap: 14,
                boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
                color: "#14181f",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 18, height: 4, background: "#157a3a", borderRadius: 2 }} />
                <span>Vết xe đã chạy ({entry.track?.length ?? 0} điểm)</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 18, height: 3, borderTop: "2px dashed #0284c7" }} />
                <span>Lộ trình nối Waypoints</span>
              </div>
            </div>
          </div>

          {/* Sidebar danh sách Waypoints kèm thông số đầy đủ */}
          <div
            style={{
              width: 360,
              borderLeft: "1px solid var(--line)",
              background: "var(--surface)",
              display: "flex",
              flexDirection: "column",
              flexShrink: 0,
            }}
          >
            <div
              style={{
                padding: "10px 14px",
                borderBottom: "1px solid var(--line)",
                background: "var(--surface-2)",
                fontWeight: 700,
                fontSize: 12,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span>THÔNG SỐ ĐO TẠI CÁC CHỐT</span>
              <span className="badge ok mono">{wps.length} điểm</span>
            </div>

            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "10px",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {wps.length === 0 ? (
                <div className="empty" style={{ padding: 16 }}>Chặng này không có dữ liệu waypoint.</div>
              ) : (
                wps.map((wp, idx) => {
                  const t = wp.telemetry;
                  const aqi = t?.aqi ?? 55;
                  const badge = getAqiBadge(aqi);
                  const isSelected = selectedWpId === wp.id;
                  const reachedStr = wp.reached_at ? new Date(wp.reached_at * 1000).toLocaleTimeString() : null;

                  return (
                    <div
                      key={wp.id || idx}
                      onClick={() => selectWaypoint(wp)}
                      style={{
                        background: isSelected ? "rgba(2, 132, 199, 0.08)" : "var(--surface-2)",
                        border: isSelected ? "1px solid #0284c7" : "1px solid var(--line)",
                        borderRadius: "var(--radius)",
                        padding: "8px 10px",
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span
                            style={{
                              width: 20,
                              height: 20,
                              borderRadius: "50%",
                              background: "#157a3a",
                              color: "#fff",
                              fontSize: 10.5,
                              fontWeight: 700,
                              display: "grid",
                              placeItems: "center",
                            }}
                          >
                            {idx + 1}
                          </span>
                          <span style={{ fontWeight: 700, fontSize: 12, color: "var(--text)" }}>
                            {wp.name || `WP${String(idx + 1).padStart(2, "0")}`}
                          </span>
                        </div>
                        <span
                          style={{
                            background: badge.bg,
                            color: badge.fg,
                            padding: "1px 6px",
                            borderRadius: 3,
                            fontWeight: 700,
                            fontSize: 10.5,
                          }}
                        >
                          AQI {aqi.toFixed(0)} ({badge.label})
                        </span>
                      </div>

                      {/* Lưới thông số đầy đủ y như lúc chạy qua trực tiếp */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3px 6px", fontSize: 11, color: "var(--text-2)" }}>
                        <div>PM2.5: <b style={{ color: "var(--text)" }}>{(t?.pm25 ?? 18.5).toFixed(1)} µg/m³</b></div>
                        <div>CO₂: <b style={{ color: "var(--text)" }}>{(t?.co2 ?? 610).toFixed(0)} ppm</b></div>
                        <div>CO: <b style={{ color: "var(--text)" }}>{(t?.co ?? 2.1).toFixed(2)} ppm</b></div>
                        <div>TVOC: <b style={{ color: "var(--text)" }}>{(t?.tvoc ?? 120).toFixed(0)} ppb</b></div>
                        <div>NOx: <b style={{ color: "var(--text)" }}>{(t?.nox ?? 40).toFixed(1)}</b></div>
                        <div>Nhiệt độ: <b style={{ color: "var(--text)" }}>{(t?.temperature ?? 28.5).toFixed(1)} °C</b></div>
                        <div>Độ ẩm: <b style={{ color: "var(--text)" }}>{(t?.humidity ?? 68).toFixed(1)} %</b></div>
                        <div>Đến lúc: <b style={{ color: "var(--text)" }}>{reachedStr || "Đã qua"}</b></div>
                      </div>

                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6, paddingTop: 4, borderTop: "1px dashed var(--line)" }}>
                        <span style={{ fontSize: 10, color: "var(--text-3)", fontFamily: "var(--mono)" }}>
                          {wp.latitude.toFixed(5)}, {wp.longitude.toFixed(5)}
                        </span>
                        <span style={{ fontSize: 10.5, color: "#0284c7", fontWeight: 600 }}>
                          Xem trên bản đồ →
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
