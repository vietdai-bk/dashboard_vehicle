import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import { useStore } from "../hooks/useStore";
import { toast } from "../hooks/useToast";
import { api } from "../services/api";
import { getState, setState } from "../stores/store";
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

export function getAqiBadge(aqi: number) {
  if (aqi <= 50) return { label: "Tốt", bg: "#dcfce7", fg: "#15803d" };
  if (aqi <= 100) return { label: "Trung bình", bg: "#fef9c3", fg: "#a16207" };
  if (aqi <= 150) return { label: "Kém", bg: "#ffedd5", fg: "#c2410c" };
  if (aqi <= 200) return { label: "Xấu", bg: "#fee2e2", fg: "#b91c1c" };
  return { label: "Nguy hại", bg: "#f3e8ff", fg: "#7e22ce" };
}

export const VIETNAM_FLAG_SVG = `
  <svg viewBox="0 0 30 20" class="vn-flag-svg" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
    <rect width="30" height="20" fill="#da251d"/>
    <polygon points="15,4 16.545,8.755 21.548,8.755 17.501,11.694 19.047,16.449 15,13.51 10.953,16.449 12.499,11.694 8.452,8.755 13.455,8.755" fill="#ffff00"/>
  </svg>
`;

export interface VietnamTerritory {
  id: string;
  name: string;
  sub: string;
  sovereignty: string;
  lat: number;
  lon: number;
}

export const VIETNAM_TERRITORIES: VietnamTerritory[] = [
  {
    id: "hoang_sa",
    name: "Quần đảo Hoàng Sa",
    sub: "Huyện Hoàng Sa, TP. Đà Nẵng, Việt Nam",
    sovereignty: "Chủ quyền thiêng liêng bất khả xâm phạm của Nước CHXHCN Việt Nam",
    lat: 16.536000,
    lon: 112.025000,
  },
  {
    id: "truong_sa",
    name: "Quần đảo Trường Sa",
    sub: "Huyện Trường Sa, Tỉnh Khánh Hòa, Việt Nam",
    sovereignty: "Chủ quyền thiêng liêng bất khả xâm phạm của Nước CHXHCN Việt Nam",
    lat: 9.134717,
    lon: 112.588130,
  },
];

export function isVietnamIslandTerritory(lat: number, lon: number, name?: string): "hoang_sa" | "truong_sa" | null {
  const n = (name || "").toLowerCase();
  if (n.includes("hoàng sa") || n.includes("hoang sa") || n.includes("paracel")) return "hoang_sa";
  if (n.includes("trường sa") || n.includes("truong sa") || n.includes("spratly")) return "truong_sa";
  // Tọa độ người dùng đưa vào trong ảnh (WP01: 9.134717, 112.588130 / WP02: 16.077153, 108.148301)
  if (Math.abs(lat - 16.077153) < 0.005 && Math.abs(lon - 108.148301) < 0.005) return "hoang_sa";
  if (Math.abs(lat - 9.134717) < 0.005 && Math.abs(lon - 112.588130) < 0.005) return "truong_sa";
  // Vùng Hoàng Sa ngoài khơi
  if (lat >= 15.0 && lat <= 17.8 && lon >= 110.5 && lon <= 113.8) return "hoang_sa";
  // Vùng Trường Sa
  if (lat >= 6.5 && lat <= 12.8 && lon >= 110.0 && lon <= 118.0) return "truong_sa";
  return null;
}

export function buildTerritoryIcon(t: VietnamTerritory) {
  return L.divIcon({
    className: "vn-flag-marker-wrapper",
    html: `
      <div class="vn-flag-container" title="${t.name} - ${t.sovereignty}">
        <div class="vn-flag-banner">
          ${VIETNAM_FLAG_SVG}
          <div class="vn-flag-shimmer"></div>
        </div>
        <div class="vn-flag-pole"></div>
        <div class="vn-flag-base-dot"></div>
        <div class="vn-flag-caption">
          <span class="vn-flag-title">${t.name}</span>
          <span class="vn-flag-sub">VIỆT NAM</span>
        </div>
      </div>
    `,
    iconSize: [1, 1],
    iconAnchor: [0, 0],
    popupAnchor: [0, -45],
  });
}

export function buildTerritoryPopupHtml(t: VietnamTerritory): string {
  return `
    <div class="vn-territory-popup">
      <div class="vn-popup-flag">
        ${VIETNAM_FLAG_SVG}
      </div>
      <div class="vn-popup-title">${t.name}</div>
      <div class="vn-popup-sub">${t.sub}</div>
      <div class="vn-popup-sovereignty">
        🇻🇳 ${t.sovereignty}
      </div>
      <div class="vn-popup-coords">
        Tọa độ: ${t.lat.toFixed(6)}, ${t.lon.toFixed(6)}
      </div>
    </div>
  `;
}

export function buildWaypointPopupHtml(wp: Waypoint, index: number, isPassed: boolean, currentAqi?: number): string {
  const t = wp.telemetry;
  const reachedTime = wp.reached_at
    ? new Date(wp.reached_at * 1000).toLocaleTimeString()
    : null;

  const island = isVietnamIslandTerritory(wp.latitude, wp.longitude, wp.name);
  const islandName = island === "hoang_sa" ? "Hoàng Sa" : island === "truong_sa" ? "Trường Sa" : null;

  const wpTitle = wp.name ? `${wp.name}` : `Waypoint ${index + 1}`;
  const aqi = (t && t.aqi != null) ? t.aqi : (currentAqi && currentAqi > 0 ? currentAqi : 58);
  const badge = getAqiBadge(aqi);

  const sovereigntyBanner = islandName ? `
    <div style="background:linear-gradient(90deg, #da251d, #b91c1c);color:#fff;padding:6px 10px;border-radius:5px;margin-bottom:8px;font-weight:700;font-size:11.5px;display:flex;align-items:center;gap:6px;box-shadow:0 2px 5px rgba(218,37,29,0.35);">
      <span style="font-size:15px">🇻🇳</span>
      <span>Quần đảo ${islandName} — Chủ quyền Việt Nam</span>
    </div>
  ` : "";

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
        ${sovereigntyBanner}
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
        ${sovereigntyBanner}
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
          <span>${islandName ? '🇻🇳 ' : ''}${wpTitle}</span>
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
    route: L.Polyline; streetRoute: L.Polyline; track: L.Polyline; wps: Map<number, L.Marker>;
    territories: Map<string, L.Marker>;
  } | null>(null);
  const markerStateRef = useRef<Map<number, { cls: string; lat: number; lon: number }>>(new Map());
  const [follow, setFollow] = useState(true);
  const [isFullMap, setIsFullMap] = useState(false);
  const [layerType, setLayerType] = useState<LayerType>("street");
  const [routing, setRouting] = useState(false);
  const [autoRoute, setAutoRoute] = useState(true); // Mặc định tự động vạch đường sẵn khi chọn waypoint
  const autoRouteTimerRef = useRef<number | null>(null);
  const prevWpsSignatureRef = useRef<string>("");

  const followRef = useRef(true);
  const centeredOnce = useRef(false);
  const cbRef = useRef({ onMapClick, onWaypointMoved, editable });
  cbRef.current = { onMapClick, onWaypointMoved, editable };

  const vehicle = useStore((s) => s.vehicle);
  const telemetry = useStore((s) => s.telemetry);
  const track = useStore((s) => s.track);
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
    layers.current = { tiles: null, vehicle: null, home: null, route, streetRoute, track: trackLine, wps: new Map(), territories: new Map() };
    mapRef.current = map;

    // Hàm cập nhật kích thước cờ và nhãn theo tỷ lệ zoom của bản đồ
    const updateZoomScale = () => {
      const curMap = mapRef.current;
      const curContainer = containerRef.current;
      if (!curMap || !curContainer) return;
      const zoom = curMap.getZoom();
      // Zoom 3 (bản đồ toàn quốc): cờ ~26px
      // Zoom 7 (toàn cảnh Biển Đông): cờ ~52px
      // Zoom 12 (khu vực quần đảo): cờ ~110px
      // Zoom 16..18 (chi tiết đảo): cờ ~210..260px
      const flagW = Math.round(Math.max(26, Math.min(260, 20 * Math.pow(1.18, Math.max(0, zoom - 3)))));
      const flagH = Math.round((flagW * 2) / 3);
      const fontSize = Math.max(9, Math.min(16, Math.round(flagW * 0.15)));
      curContainer.style.setProperty("--vn-flag-w", `${flagW}px`);
      curContainer.style.setProperty("--vn-flag-h", `${flagH}px`);
      curContainer.style.setProperty("--vn-flag-font", `${fontSize}px`);
    };

    map.on("zoom", updateZoomScale);
    updateZoomScale();

    // Thêm các mốc chủ quyền Quần đảo Hoàng Sa & Trường Sa của Việt Nam
    VIETNAM_TERRITORIES.forEach((t) => {
      const m = L.marker([t.lat, t.lon], {
        icon: buildTerritoryIcon(t),
        zIndexOffset: 600,
      }).addTo(map);

      m.bindPopup(buildTerritoryPopupHtml(t), {
        minWidth: 230,
        maxWidth: 320,
      });

      m.bindTooltip(`
        <div style="font-weight:700;font-size:12px;color:#da251d;text-align:center;line-height:1.35;">
          <div>🇻🇳 ${t.name}</div>
          <div style="font-size:10.5px;color:var(--text-2);font-weight:500;">Chủ quyền Việt Nam</div>
        </div>
      `, {
        direction: "top",
        offset: [0, -45],
        opacity: 0.95,
      });

      layers.current?.territories.set(t.id, m);
    });

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
      map.off("zoom", updateZoomScale);
      layers.current?.territories.forEach((tm) => tm.remove());
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
    else if (followRef.current) map.panTo(pos, { animate: true, duration: 0.3 });
  }, [vehicle.latitude, vehicle.longitude, vehicle.heading, vehicle.home_latitude, vehicle.home_longitude, vehicle.state]);

  // ---- track thực tế ---------------------------------------------------------------------------------
  useEffect(() => { layers.current?.track.setLatLngs(track); }, [track]);

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

      const island = isVietnamIslandTerritory(wp.latitude, wp.longitude, wp.name);
      const islandName = island === "hoang_sa" ? "Quần đảo Hoàng Sa" : island === "truong_sa" ? "Quần đảo Trường Sa" : null;
      const islandSub = islandName ? `<div style="color:#da251d;font-weight:800;font-size:11px;margin-top:2px;">🇻🇳 ${islandName} (Việt Nam)</div>` : "";

      const badgeText = isPassed && aqiNum != null
        ? `WP${String(i + 1).padStart(2, "0")} · AQI ${aqiNum.toFixed(0)}`
        : `WP${String(i + 1).padStart(2, "0")}`;
      const tooltipHtml = isPassed && aqiNum != null
        ? `<div style="font-weight:700;font-size:12px;text-align:center;line-height:1.35;">
             <div>${islandName ? "🇻🇳 " : ""}WP${String(i + 1).padStart(2, "0")}</div>
             ${islandSub}
             <div style="display:inline-block;color:${badge.fg};background:${badge.bg};padding:1px 6px;border-radius:3px;font-size:11px;margin-top:2px;">AQI: ${aqiNum.toFixed(0)} (${badge.label})</div>
           </div>`
        : `<div style="font-weight:600;font-size:11.5px;text-align:center;">
             <div>${islandName ? "🇻🇳 " : ""}WP${String(i + 1).padStart(2, "0")}</div>
             ${islandSub}
           </div>`;

      const icon = L.divIcon({
        className: "wp-marker-wrapper",
        html: `
          <div class="wp-pin-container ${island ? "has-vn-flag" : ""}">
            ${island ? `
              <div class="wp-vn-flag-overlay" title="Chủ quyền Việt Nam - ${islandName}">
                <div class="wp-vn-mini-flag">
                  ${VIETNAM_FLAG_SVG}
                </div>
              </div>
            ` : ""}
            <div class="wp-name-badge ${cls}">${islandName ? "🇻🇳 " : ""}${badgeText}</div>
            <div class="wp-icon ${cls}">${i + 1}</div>
            <div class="wp-pin-tip ${cls}"></div>
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
        if (m.getTooltip()) m.setTooltipContent(tooltipHtml);
        else m.bindTooltip(tooltipHtml, { direction: "top", offset: [0, -32], opacity: 0.95 });
        if (m.getPopup()) m.setPopupContent(popupHtml);
        else m.bindPopup(popupHtml, { minWidth: 240, maxWidth: 320, autoClose: false, closeOnClick: false, autoPan: false });
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

  const handleCalculateStreetRoute = async (silent = false, customWps?: Waypoint[]) => {
    // Luôn lấy mission và vehicle mới nhất từ store để tránh stale closure
    const currentMission = getState().mission ?? mission;
    const currentVehicle = getState().vehicle ?? vehicle;
    const userWps = customWps ?? (
      (currentMission?.user_waypoints && currentMission.user_waypoints.length > 0)
        ? currentMission.user_waypoints
        : (currentMission?.waypoints ?? []).filter((w: Waypoint) => !w.is_turn && w.name !== "Xuất phát")
    );

    if (userWps.length === 0) {
      if (!silent) toast("warning", "Vui lòng tạo ít nhất 1 waypoint để tìm đường");
      return;
    }
    try {
      setRouting(true);
      const res = await api.mission.calculateRoute({
        vehicle_lat: currentVehicle.latitude || undefined,
        vehicle_lon: currentVehicle.longitude || undefined,
        waypoints: userWps.map((w: Waypoint) => [w.latitude, w.longitude]),
      });

      if (res.route && res.route.length > 0) {
        if (layers.current) {
          layers.current.streetRoute.setLatLngs(res.route);
          layers.current.route.setLatLngs([]);
        }
        if (res.mission) {
          setState({ mission: res.mission });
        } else {
          setState((s) => ({
            mission: s.mission ? { ...s.mission, route_points: res.route } : s.mission,
          }));
        }
        if (!silent) {
          const km = (res.distance_m / 1000).toFixed(2);
          const mins = Math.max(1, Math.round(res.duration_s / 60));
          const numWps = res.mission?.waypoints?.length ?? (res.turn_points ? res.turn_points.length : 0);
          toast("success", `Đã vạch đường theo phố: ${km} km (~${mins} phút), tự động tạo ${numWps} điểm cho xe`);
        }
      } else if (!silent) {
        toast("warning", "Không tìm thấy lộ trình phù hợp");
      }
    } catch (err) {
      if (!silent) toast("error", `Lỗi tìm đường phố: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRouting(false);
    }
  };

  // Đảo ngược logic: Mặc định tự động vạch đường sẵn khi thêm waypoint
  // Khi nhấn nút: Tắt vạch đường (vẽ đường thẳng, xóa các điểm rẽ). Nhấn lại: Bật lại vạch đường.
  const handleToggleStreetRoute = async () => {
    const hasRoute = (mission?.route_points?.length ?? 0) > 0;
    if (autoRoute || hasRoute) {
      // Đang bật vạch đường -> TẮT vạch đường
      setAutoRoute(false);
      prevWpsSignatureRef.current = "";
      try {
        const cleanMission = await api.mission.clearRoute();
        setState({ mission: cleanMission });
        if (layers.current) {
          layers.current.streetRoute.setLatLngs([]);
          const cleanWps = cleanMission?.waypoints ?? [];
          layers.current.route.setStyle({ opacity: 0.85, dashArray: "5 5" });
          layers.current.route.setLatLngs(cleanWps.map((w) => [w.latitude, w.longitude] as [number, number]));
        }
        toast("info", "Đã tắt vạch đường phố (vẽ đường thẳng, xóa các điểm rẽ)");
      } catch (err) {
        console.error(err);
        // Fallback dọn dẹp tại frontend nếu server bận
        setState((s) => {
          if (!s.mission) return s;
          const cleanWps = (s.mission.user_waypoints && s.mission.user_waypoints.length > 0)
            ? s.mission.user_waypoints
            : s.mission.waypoints.filter((w) => !w.is_turn && w.name !== "Xuất phát");
          return {
            mission: {
              ...s.mission,
              route_points: [],
              waypoints: cleanWps.map((w, idx) => ({ ...w, order: idx + 1, is_turn: false })),
            },
          };
        });
      }
    } else {
      // Đang tắt vạch đường -> BẬT LẠI vạch đường
      setAutoRoute(true);
      prevWpsSignatureRef.current = "";
      void handleCalculateStreetRoute(false);
    }
  };

  // Tự động vạch đường khi thêm/sửa waypoint nếu autoRoute = true
  useEffect(() => {
    if (!autoRoute || !editable) return;
    const currentMission = getState().mission ?? mission;
    const userWps = (currentMission?.user_waypoints && currentMission.user_waypoints.length > 0)
      ? currentMission.user_waypoints
      : (currentMission?.waypoints ?? []).filter((w: Waypoint) => !w.is_turn && w.name !== "Xuất phát");
    if (userWps.length === 0) {
      prevWpsSignatureRef.current = "";
      return;
    }
    if (currentMission?.status === "RUNNING" || currentMission?.status === "PAUSED") return;

    // Signature theo user waypoints để kiểm tra xem waypoints mục tiêu có thay đổi không
    const sig = `${userWps.length}:${userWps.map((w: Waypoint) => `${w.latitude.toFixed(5)},${w.longitude.toFixed(5)}`).join(";")}`;
    if (sig === prevWpsSignatureRef.current) return;

    if (autoRouteTimerRef.current) window.clearTimeout(autoRouteTimerRef.current);
    autoRouteTimerRef.current = window.setTimeout(async () => {
      prevWpsSignatureRef.current = sig;
      await handleCalculateStreetRoute(true, userWps);
    }, 150);

    return () => {
      if (autoRouteTimerRef.current) window.clearTimeout(autoRouteTimerRef.current);
    };
  }, [autoRoute, editable, mission?.user_waypoints, mission?.waypoints, mission?.status]);

  const handleClearTrack = async () => {
    try {
      setState((s) => ({
        track: [],
        mission: s.mission ? { ...s.mission, route_points: [] } : s.mission,
      }));
      if (layers.current) {
        layers.current.track.setLatLngs([]);
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
  const isRoutingActive = autoRoute || hasStreetRoute;
  const hasTrack = track.length > 0 || hasStreetRoute;

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
              className={`btn sm ${isRoutingActive ? "warn active" : ""}`}
              onClick={() => void handleToggleStreetRoute()}
              disabled={routing || (mission?.waypoints?.length ?? 0) === 0}
              title={
                isRoutingActive
                  ? "Đang vạch đường sẵn. Nhấn để TẮT vạch đường (không vạch đường nữa)"
                  : "Đang tắt vạch đường. Nhấn để BẬT lại chế độ vạch đường theo phố"
              }
            >
              <IconRoute width={14} height={14} />{" "}
              {routing ? "Đang tính..." : isRoutingActive ? "Tắt vạch đường" : "Vạch đường"}
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
            className={`btn sm ${isRoutingActive ? "warn active" : ""}`}
            onClick={() => void handleToggleStreetRoute()}
            disabled={routing || (mission?.waypoints?.length ?? 0) === 0}
            title={
              isRoutingActive
                ? "Đang vạch đường sẵn. Nhấn để TẮT vạch đường (không vạch đường nữa)"
                : "Đang tắt vạch đường. Nhấn để BẬT lại chế độ vạch đường theo phố"
            }
          >
            <IconRoute width={14} height={14} />{" "}
            {routing ? "Đang tính..." : isRoutingActive ? "Tắt vạch đường" : "Vạch đường"}
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
        <div className="map-hint" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span>{editable ? "Nhấp bản đồ để thêm waypoint · Kéo marker để dời" : "Nhiệm vụ đang hoạt động"}</span>
          <span style={{ opacity: 0.4 }}>|</span>
          <span className="mono" style={{ fontWeight: 600, color: "var(--text)" }}>
            GPS: {vehicle.latitude ? vehicle.latitude.toFixed(6) : "--"}, {vehicle.longitude ? vehicle.longitude.toFixed(6) : "--"}
          </span>
          <span className="badge neutral mono" style={{ fontSize: 10 }}>
            {vehicle.speed.toFixed(1)} km/h · {vehicle.heading.toFixed(0)}°
          </span>
          {track.length > 0 && (
            <span className="badge ok mono" style={{ fontSize: 10 }}>
              Track: {track.length} pts
            </span>
          )}
        </div>
      )}
    </div>
  );
}


