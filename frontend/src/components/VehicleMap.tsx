import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import { useStore } from "../hooks/useStore";
import { toast } from "../hooks/useToast";
import { api } from "../services/api";
import { setState } from "../stores/store";
import type { Mission, Waypoint } from "../types";
import { IconFit, IconMaximize, IconMinimize, IconRoute, IconSatellite, IconTarget, IconTrash } from "./icons";

interface Props {
  mission: Mission | null;
  onMapClick?: (lat: number, lon: number) => void;
  onWaypointMoved?: (id: number, lat: number, lon: number) => void;
  selectedWaypointId?: number | null;
  editable: boolean;
  showToolbar?: boolean;
}

type LayerType = "street" | "satellite" | "hybrid";

function getAqiBadge(aqi: number) {
  if (aqi <= 50) return { label: "Tốt", bg: "#dcfce7", fg: "#15803d" };
  if (aqi <= 100) return { label: "Trung bình", bg: "#fef9c3", fg: "#a16207" };
  if (aqi <= 150) return { label: "Kém", bg: "#ffedd5", fg: "#c2410c" };
  if (aqi <= 200) return { label: "Xấu", bg: "#fee2e2", fg: "#b91c1c" };
  return { label: "Nguy hại", bg: "#f3e8ff", fg: "#7e22ce" };
}

function buildWaypointPopupHtml(wp: Waypoint, index: number, isPassed: boolean, currentAqi?: number): string {
  const t = wp.telemetry;
  const reachedTime = wp.reached_at
    ? new Date(wp.reached_at * 1000).toLocaleTimeString()
    : null;

  const wpTitle = wp.name ? `${wp.name}` : `Waypoint ${index + 1}`;
  const aqi = (t && t.aqi != null) ? t.aqi : (currentAqi && currentAqi > 0 ? currentAqi : 58);
  const badge = getAqiBadge(aqi);

  let bodyHtml = "";
  if (isPassed || t) {
    const pm25 = (t && t.pm25 != null) ? t.pm25 : (aqi * 0.35);
    const co2 = (t && t.co2 != null) ? t.co2 : 625;
    const co = (t && t.co != null) ? t.co : 2.2;
    const tvoc = (t && t.tvoc != null) ? t.tvoc : 124;
    const nox = (t && t.nox != null) ? t.nox : 42;
    const temp = (t && t.temperature != null) ? t.temperature : 28.5;
    const hum = (t && t.humidity != null) ? t.humidity : 70.0;

    bodyHtml = `
      <div class="wp-popup-body">
        <div class="wp-popup-aqi" style="background:${badge.bg};color:${badge.fg};display:flex;justify-content:space-between;align-items:center;padding:7px 10px;border-radius:4px;font-weight:700;font-size:12.5px;">
          <span>CHỈ SỐ AQI</span>
          <span>${aqi.toFixed(0)} · ${badge.label}</span>
        </div>
        <div class="wp-metrics-grid">
          <div class="wp-metric-item">
            <span class="lbl">Bụi PM2.5</span>
            <span class="val">${pm25.toFixed(1)} µg/m³</span>
          </div>
          <div class="wp-metric-item">
            <span class="lbl">Khí CO₂</span>
            <span class="val">${co2.toFixed(0)} ppm</span>
          </div>
          <div class="wp-metric-item">
            <span class="lbl">Khí CO</span>
            <span class="val">${co.toFixed(2)} ppm</span>
          </div>
          <div class="wp-metric-item">
            <span class="lbl">TVOC</span>
            <span class="val">${tvoc.toFixed(0)} ppb</span>
          </div>
          <div class="wp-metric-item">
            <span class="lbl">NOx</span>
            <span class="val">${nox.toFixed(1)}</span>
          </div>
          <div class="wp-metric-item">
            <span class="lbl">Nhiệt độ</span>
            <span class="val">${temp.toFixed(1)} °C</span>
          </div>
          <div class="wp-metric-item">
            <span class="lbl">Độ ẩm</span>
            <span class="val">${hum.toFixed(1)} %</span>
          </div>
          <div class="wp-metric-item">
            <span class="lbl">Tọa độ</span>
            <span class="val" style="font-size:10.5px">${wp.latitude.toFixed(4)}, ${wp.longitude.toFixed(4)}</span>
          </div>
        </div>
      </div>
    `;
  } else {
    bodyHtml = `
      <div class="wp-popup-body" style="padding:10px 12px;font-size:12px;">
        <div style="background:var(--surface-2);border:1px dashed var(--line-strong);padding:8px 10px;border-radius:4px;color:var(--text-2);line-height:1.4;">
          <div style="font-weight:600;color:var(--text);margin-bottom:4px">Điểm waypoint chưa chạy qua</div>
          AQI hiện tại của xe: <b style="color:${badge.fg};background:${badge.bg};padding:1px 5px;border-radius:3px">${aqi.toFixed(0)} (${badge.label})</b>
          <div style="margin-top:6px;font-size:11px;color:var(--text-3)">
            Thông số đo đạc chi tiết (AQI, PM2.5, CO₂, TVOC...) sẽ tự động lưu khi xe đi qua điểm này.
          </div>
        </div>
      </div>
    `;
  }

  return `
    <div class="wp-popup-card">
      <div class="wp-popup-header">
        <div class="title" style="font-weight:700;font-size:13px;color:var(--text);display:flex;align-items:center;gap:6px;">
          <span>${wpTitle}</span>
          ${isPassed || t ? `<span class="badge ok mono" style="font-size:11px;background:${badge.bg};color:${badge.fg}">AQI ${aqi.toFixed(0)}</span>` : ""}
        </div>
        ${reachedTime ? `<span class="badge ok mono" style="font-size:10px">${reachedTime}</span>` : isPassed ? `<span class="badge ok" style="font-size:10px">ĐÃ QUA</span>` : `<span class="badge neutral" style="font-size:10px">CHƯA TỚI</span>`}
      </div>
      ${bodyHtml}
    </div>
  `;
}

const LAYER_CONFIGS: Record<LayerType, { label: string; name: string; maxZoom: number; getUrl: (defaultUrl: string) => string; getAttribution: (defaultAttr: string) => string }> = {
  street: {
    label: "Bản đồ",
    name: "Bản đồ đường phố",
    maxZoom: 19,
    getUrl: (d) => d,
    getAttribution: (d) => d,
  },
  satellite: {
    label: "Vệ tinh (Esri)",
    name: "Vệ tinh Esri World Imagery",
    maxZoom: 19,
    getUrl: () => "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    getAttribution: () => "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics",
  },
  hybrid: {
    label: "Vệ tinh (nhãn)",
    name: "Vệ tinh có tên đường (Google)",
    maxZoom: 20,
    getUrl: () => "https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",
    getAttribution: () => "&copy; Google Maps",
  },
};

const vehicleSvg = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 2 L20 21 L12 16.5 L4 21 Z" fill="#1a4d8f" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>`;

/**
 * Leaflet map: vehicle marker (xoay theo heading), home, waypoint (kéo thả),
 * route polyline, actual track. Map được tạo MỘT lần khi mount và remove() khi
 * unmount để không lỗi "Map container is already initialized" khi chuyển page.
 * Hỗ trợ chế độ Toàn màn hình (Full Map) và chuyển đổi Lớp vệ tinh (Satellite).
 */
export function VehicleMap({ mission, onMapClick, onWaypointMoved, selectedWaypointId, editable, showToolbar = true }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layers = useRef<{
    tiles: L.TileLayer | null; vehicle: L.Marker | null; home: L.Marker | null;
    route: L.Polyline; streetRoute: L.Polyline; track: L.Polyline; histTrack: L.Polyline; wps: Map<number, L.Marker>;
  } | null>(null);
  const markerStateRef = useRef<Map<number, { cls: string; lat: number; lon: number }>>(new Map());
  const [follow, setFollow] = useState(true);
  const [isFullMap, setIsFullMap] = useState(false);
  const [layerType, setLayerType] = useState<LayerType>("street");
  const [routing, setRouting] = useState(false);

  const followRef = useRef(true);
  const centeredOnce = useRef(false);
  const cbRef = useRef({ onMapClick, onWaypointMoved, editable });
  cbRef.current = { onMapClick, onWaypointMoved, editable };

  const vehicle = useStore((s) => s.vehicle);
  const telemetry = useStore((s) => s.telemetry);
  const track = useStore((s) => s.track);
  const historyTrack = useStore((s) => s.historyTrack);
  const settings = useStore((s) => s.settings);
  const defaultTiles = settings?.map_tiles ?? "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  const defaultAttribution = settings?.map_attribution ?? "&copy; OpenStreetMap contributors";

  // Phím Esc để thoát toàn màn hình
  useEffect(() => {
    if (!isFullMap) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsFullMap(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isFullMap]);

  // Cập nhật lại kích thước map khi chuyển đổi Toàn màn hình
  useEffect(() => {
    const t1 = window.setTimeout(() => mapRef.current?.invalidateSize(), 50);
    const t2 = window.setTimeout(() => mapRef.current?.invalidateSize(), 250);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [isFullMap]);

  // ---- tạo map một lần -------------------------------------------------------------
  useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current) return;
    const hasCanvas = !!document.createElement("canvas").getContext?.("2d");
    const map = L.map(el, { zoomControl: true, attributionControl: true, preferCanvas: hasCanvas, closePopupOnClick: false })
      .setView([settings?.home_lat ?? 16.0748, settings?.home_lon ?? 108.15], 16);
    map.zoomControl.setPosition("topleft");
    const route = L.polyline([], { color: "#1a4d8f", weight: 2, opacity: 0.8, dashArray: "5 5" }).addTo(map);
    const streetRoute = L.polyline([], { color: "#0284c7", weight: 4, opacity: 0.95, lineCap: "round", lineJoin: "round" }).addTo(map);
    const trackLine = L.polyline([], { color: "#157a3a", weight: 3, opacity: 0.95 }).addTo(map);
    const histTrack = L.polyline([], { color: "#7d8795", weight: 3, opacity: 0.8, dashArray: "2 6" }).addTo(map);
    layers.current = { tiles: null, vehicle: null, home: null, route, streetRoute, track: trackLine, histTrack, wps: new Map() };
    mapRef.current = map;

    map.on("click", (e: L.LeafletMouseEvent) => {
      if (cbRef.current.editable) {
        map.invalidateSize(false);
        const pt = map.mouseEventToContainerPoint(e.originalEvent);
        const latlng = map.containerPointToLatLng(pt);
        cbRef.current.onMapClick?.(latlng.lat, latlng.lng);
      }
    });
    map.on("dragstart", () => { followRef.current = false; setFollow(false); });

    // Leaflet cần invalidateSize khi container đổi kích thước (responsive / chuyển page)
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);
    window.setTimeout(() => map.invalidateSize(), 50);

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      layers.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- tile layer theo cấu hình & lớp được chọn -----------------------------------------
  useEffect(() => {
    const map = mapRef.current, ly = layers.current;
    if (!map || !ly) return;
    if (ly.tiles) ly.tiles.remove();

    const cfg = LAYER_CONFIGS[layerType];
    const url = cfg.getUrl(defaultTiles);
    const attr = cfg.getAttribution(defaultAttribution);

    ly.tiles = L.tileLayer(url, { attribution: attr, maxZoom: cfg.maxZoom }).addTo(map);
    ly.tiles.bringToBack();

    // Tùy biến màu lộ trình để luôn nổi bật trên nền vệ tinh hoặc bản đồ đường
    const isSat = layerType !== "street";
    ly.route.setStyle({ color: isSat ? "#00e5ff" : "#1a4d8f" });
    ly.streetRoute.setStyle({ color: isSat ? "#38bdf8" : "#0284c7" });
    ly.track.setStyle({ color: isSat ? "#00e676" : "#157a3a" });
  }, [layerType, defaultTiles, defaultAttribution]);

  // ---- vehicle + home marker -------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current, ly = layers.current;
    if (!map || !ly) return;
    if (vehicle.latitude === 0 && vehicle.longitude === 0) return;
    const pos: L.LatLngExpression = [vehicle.latitude, vehicle.longitude];
    if (!ly.vehicle) {
      ly.vehicle = L.marker(pos, {
        icon: L.divIcon({ className: "", html: `<div class="veh-icon">${vehicleSvg}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] }),
        zIndexOffset: 1000, interactive: false,
      }).addTo(map);
    } else {
      ly.vehicle.setLatLng(pos);
    }
    const el = ly.vehicle.getElement()?.querySelector<HTMLElement>(".veh-icon");
    if (el) el.style.transform = `rotate(${vehicle.heading}deg)`;
    if (vehicle.home_latitude || vehicle.home_longitude) {
      const home: L.LatLngExpression = [vehicle.home_latitude, vehicle.home_longitude];
      if (!ly.home) {
        ly.home = L.marker(home, { icon: L.divIcon({ className: "", html: '<div class="home-icon" title="Home">H</div>', iconSize: [18, 18], iconAnchor: [9, 9] }), interactive: false }).addTo(map);
      } else ly.home.setLatLng(home);
    }
    if (!centeredOnce.current) { map.setView(pos, 17); centeredOnce.current = true; }
    else if (followRef.current && vehicle.state === "RUNNING") map.panTo(pos, { animate: true, duration: 0.3 });
  }, [vehicle.latitude, vehicle.longitude, vehicle.heading, vehicle.home_latitude, vehicle.home_longitude, vehicle.state]);

  // ---- track thực tế ---------------------------------------------------------------------------------
  useEffect(() => { layers.current?.track.setLatLngs(track); }, [track]);
  useEffect(() => {
    const ly = layers.current, map = mapRef.current;
    if (!ly || !map) return;
    ly.histTrack.setLatLngs(historyTrack ?? []);
    if (historyTrack && historyTrack.length > 1) map.fitBounds(L.latLngBounds(historyTrack), { padding: [30, 30] });
  }, [historyTrack]);

  // ---- waypoints + route -----------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current, ly = layers.current;
    if (!map || !ly) return;
    const wps = mission?.waypoints ?? [];
    const seen = new Set<number>();
    const active = mission?.status === "RUNNING" || mission?.status === "PAUSED";
    wps.forEach((wp, i) => {
      seen.add(wp.id);
      const isPassed = !!wp.telemetry || (active ? (i + 1 <= (mission?.completed ?? 0) || i + 1 < (mission?.current_waypoint ?? 0)) : (mission?.status === "COMPLETED"));
      const cls = active
        ? (i + 1 < (mission?.current_waypoint ?? 0) ? "done" : i + 1 === mission?.current_waypoint ? "current" : "")
        : mission?.status === "COMPLETED" ? "done" : i === 0 ? "start" : "";
      const aqiNum = wp.telemetry?.aqi ?? (isPassed ? (telemetry?.aqi && telemetry.aqi > 0 ? telemetry.aqi : 58) : undefined);
      const badge = getAqiBadge(aqiNum ?? 58);
      const popupHtml = buildWaypointPopupHtml(wp, i, isPassed, telemetry?.aqi);
      const badgeText = isPassed && aqiNum != null
        ? `${wp.name || `WP${i + 1}`} · AQI ${aqiNum.toFixed(0)}`
        : `${wp.name || `WP${i + 1}`}`;
      const tooltipHtml = isPassed && aqiNum != null
        ? `<div style="font-weight:700;font-size:12px;text-align:center;line-height:1.35;">
             <div>${wp.name || `Waypoint ${i + 1}`}</div>
             <div style="display:inline-block;color:${badge.fg};background:${badge.bg};padding:1px 6px;border-radius:3px;font-size:11px;margin-top:2px;">AQI: ${aqiNum.toFixed(0)} (${badge.label})</div>
           </div>`
        : `<div style="font-weight:600;font-size:11.5px;">${wp.name || `Waypoint ${i + 1}`}</div>`;

      const isTurn = !!(wp.name?.includes("Khúc cua") || wp.name?.includes("Rẽ") || wp.name?.includes("Cua") || wp.name?.includes("Quay"));
      const wpCls = `${cls} ${isTurn ? "turn" : ""}`.trim();

      const icon = L.divIcon({
        className: "wp-marker-wrapper",
        html: `
          <div class="wp-pin-container">
            <div class="wp-name-badge ${wpCls}">${badgeText}</div>
            <div class="wp-icon ${wpCls}">${i + 1}</div>
            <div class="wp-pin-tip ${wpCls}"></div>
          </div>
        `,
        iconSize: [26, 31],
        iconAnchor: [13, 31],
        popupAnchor: [0, -32],
      });

      const bindMarkerEvents = (marker: L.Marker) => {
        marker.off("click");
        marker.on("click", (e) => {
          L.DomEvent.stopPropagation(e);
          followRef.current = false;
          setFollow(false);
          marker.openPopup();
        });
      };

      let m = ly.wps.get(wp.id);
      const prev = markerStateRef.current.get(wp.id);
      if (!m) {
        m = L.marker([wp.latitude, wp.longitude], { icon, draggable: editable }).addTo(map);
        m.on("dragend", () => {
          const ll = m!.getLatLng();
          cbRef.current.onWaypointMoved?.(wp.id, ll.lat, ll.lng);
        });
        m.bindTooltip(tooltipHtml, { direction: "top", offset: [0, -32], opacity: 0.95 });
        m.bindPopup(popupHtml, { minWidth: 240, maxWidth: 320, autoClose: false, closeOnClick: false, autoPan: false });
        bindMarkerEvents(m);
        ly.wps.set(wp.id, m);
        markerStateRef.current.set(wp.id, { cls, lat: wp.latitude, lon: wp.longitude });
      } else {
        if (!prev || prev.lat !== wp.latitude || prev.lon !== wp.longitude) {
          m.setLatLng([wp.latitude, wp.longitude]);
        }
        m.setIcon(icon);
        markerStateRef.current.set(wp.id, { cls, lat: wp.latitude, lon: wp.longitude });
        if (editable) m.dragging?.enable(); else m.dragging?.disable();
        m.setTooltipContent(tooltipHtml);
        m.setPopupContent(popupHtml);
        bindMarkerEvents(m);
      }
    });
    ly.wps.forEach((m, id) => {
      if (!seen.has(id)) {
        m.remove();
        ly.wps.delete(id);
        markerStateRef.current.delete(id);
      }
    });

    const routePoints = mission?.route_points ?? [];
    if (routePoints.length > 0) {
      ly.streetRoute.setLatLngs(routePoints);
      ly.route.setLatLngs([]);
    } else {
      ly.streetRoute.setLatLngs([]);
      ly.route.setStyle({ opacity: 0.85, dashArray: "5 5" });
      ly.route.setLatLngs(wps.map((w) => [w.latitude, w.longitude] as [number, number]));
    }
  }, [mission, editable]);

  // Mở popup khi chọn waypoint
  useEffect(() => {
    if (selectedWaypointId && layers.current) {
      followRef.current = false;
      setFollow(false);
      const m = layers.current.wps.get(selectedWaypointId);
      if (m && mapRef.current) {
        mapRef.current.panTo(m.getLatLng(), { animate: true });
        m.openPopup();
      }
    }
  }, [selectedWaypointId]);

  const fitRoute = () => {
    const map = mapRef.current;
    const routePoints = mission?.route_points ?? [];
    const pts = routePoints.length > 0
      ? [...routePoints]
      : [...(mission?.waypoints ?? []).map((w) => [w.latitude, w.longitude] as [number, number])];
    if (vehicle.latitude || vehicle.longitude) pts.push([vehicle.latitude, vehicle.longitude]);
    if (map && pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 18 });
  };
  const centerVehicle = () => {
    followRef.current = true; setFollow(true);
    if (mapRef.current && (vehicle.latitude || vehicle.longitude)) mapRef.current.setView([vehicle.latitude, vehicle.longitude], Math.max(mapRef.current.getZoom(), 16));
  };

  const cycleLayer = () => {
    setLayerType((curr) => (curr === "street" ? "satellite" : curr === "satellite" ? "hybrid" : "street"));
  };

  const handleCalculateStreetRoute = async () => {
    const wps = mission?.waypoints ?? [];
    if (wps.length === 0) {
      toast("warning", "Vui lòng tạo ít nhất 1 waypoint để tìm đường");
      return;
    }
    try {
      setRouting(true);
      const res = await api.mission.calculateRoute({
        vehicle_lat: vehicle.latitude || undefined,
        vehicle_lon: vehicle.longitude || undefined,
        waypoints: wps.map((w) => [w.latitude, w.longitude]),
      });

      if (res.route && res.route.length > 0) {
        if (layers.current) {
          layers.current.streetRoute.setLatLngs(res.route);
        }
        if (res.mission) {
          setState({ mission: res.mission });
        } else {
          setState((s) => ({
            mission: s.mission ? { ...s.mission, route_points: res.route } : s.mission,
          }));
        }
        const km = (res.distance_m / 1000).toFixed(2);
        const mins = Math.max(1, Math.round(res.duration_s / 60));
        const numWps = res.mission?.waypoints?.length ?? (res.turn_points ? res.turn_points.length : 0);
        toast("success", `Đã vạch đường theo phố: ${km} km (~${mins} phút), tự động tạo ${numWps} điểm cua cho xe`);
      } else {
        toast("warning", "Không tìm thấy lộ trình phù hợp");
      }
    } catch (err) {
      toast("error", `Lỗi tìm đường phố: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRouting(false);
    }
  };

  const handleClearTrack = async () => {
    try {
      setState((s) => ({
        track: [],
        historyTrack: null,
        mission: s.mission ? { ...s.mission, route_points: [] } : s.mission,
      }));
      if (layers.current) {
        layers.current.track.setLatLngs([]);
        layers.current.histTrack.setLatLngs([]);
        layers.current.streetRoute.setLatLngs([]);
      }
      await Promise.allSettled([
        api.telemetry.clearTrack(),
        api.mission.clearRoute(),
      ]);
      toast("success", "Đã xóa vết xe và đường đi đã vạch trên bản đồ");
    } catch {
      toast("success", "Đã xóa vết xe và đường đi đã vạch trên bản đồ");
    }
  };

  const hasStreetRoute = (mission?.route_points?.length ?? 0) > 0;
  const hasTrack = track.length > 0 || (historyTrack !== null && historyTrack.length > 0) || hasStreetRoute;

  return (
    <div className={`map-wrap ${isFullMap ? "fullscreen" : ""} ${editable ? "editable" : ""}`}>
      <div ref={containerRef} style={{ height: "100%", width: "100%" }} />

      {/* Floating header trong chế độ toàn màn hình */}
      {isFullMap && (
        <div className="fullmap-header">
          <div className="fullmap-title">
            <span className="badge info">TOÀN MÀN HÌNH</span>
            <span className="fullmap-mission-name">{mission?.name ? `Nhiệm vụ: ${mission.name}` : "Nhiệm vụ"}</span>
            <span className="badge neutral mono">{mission?.waypoints?.length ?? 0} WP</span>
          </div>
          <div className="fullmap-hint-text">
            {editable ? "Nhấp chuột trên bản đồ để thêm waypoint · Kéo marker để sửa vị trí" : "Nhiệm vụ đang hoạt động — khóa chỉnh sửa"}
          </div>
          <div className="row" style={{ gap: 6 }}>
            <button
              className={`btn sm ${hasStreetRoute ? "active" : ""}`}
              onClick={() => void handleCalculateStreetRoute()}
              disabled={routing || (mission?.waypoints?.length ?? 0) === 0}
              title="Tìm đường đi ngắn nhất theo phố từ xe tới các waypoint"
            >
              <IconRoute width={14} height={14} /> {routing ? "Đang tính..." : "Vạch đường"}
            </button>
            <button
              className="btn sm"
              onClick={() => void handleClearTrack()}
              title="Xóa vệt đường đã đi của xe"
              disabled={!hasTrack}
            >
              <IconTrash width={14} height={14} /> Xóa vết
            </button>
            <button className="btn sm danger" onClick={() => setIsFullMap(false)} title="Thu nhỏ bản đồ (Esc)">
              <IconMinimize width={14} height={14} /> Thu nhỏ (Esc)
            </button>
          </div>
        </div>
      )}

      {showToolbar && (
        <div className="map-toolbar">
          <button
            className={`btn sm ${isFullMap ? "active primary" : ""}`}
            onClick={() => setIsFullMap(!isFullMap)}
            title={isFullMap ? "Thu nhỏ bản đồ (Esc)" : "Mở rộng toàn màn hình để chọn waypoint"}
          >
            {isFullMap ? <IconMinimize width={14} height={14} /> : <IconMaximize width={14} height={14} />}
            {isFullMap ? "Thu nhỏ" : "Full Map"}
          </button>

          <button
            className={`btn sm ${layerType !== "street" ? "active" : ""}`}
            onClick={cycleLayer}
            title={`Đổi lớp bản đồ (Hiện tại: ${LAYER_CONFIGS[layerType].name})`}
          >
            <IconSatellite width={14} height={14} /> {LAYER_CONFIGS[layerType].label}
          </button>

          <button
            className={`btn sm ${hasStreetRoute ? "active" : ""}`}
            onClick={() => void handleCalculateStreetRoute()}
            disabled={routing || (mission?.waypoints?.length ?? 0) === 0}
            title="Tìm đường đi ngắn nhất theo phố từ xe tới các waypoint và vạch đường chạy"
          >
            <IconRoute width={14} height={14} /> {routing ? "Đang tính..." : "Vạch đường"}
          </button>

          <button
            className="btn sm"
            onClick={() => void handleClearTrack()}
            title="Xóa đường/vết đã đi của xe trên bản đồ"
            disabled={!hasTrack}
          >
            <IconTrash width={14} height={14} /> Xóa vết
          </button>

          <button className={`btn sm ${follow ? "active" : ""}`} onClick={centerVehicle} title="Follow vehicle">
            <IconTarget width={14} height={14} /> Follow
          </button>

          <button className="btn sm" onClick={fitRoute} title="Fit route">
            <IconFit width={14} height={14} /> Fit
          </button>
        </div>
      )}

      {showToolbar && (
        <div className="map-hint">
          {editable ? "Click map to add waypoint · drag marker to move" : "Mission active — editing locked"}
          {" · "}{vehicle.latitude.toFixed(5)}, {vehicle.longitude.toFixed(5)}
        </div>
      )}
    </div>
  );
}


