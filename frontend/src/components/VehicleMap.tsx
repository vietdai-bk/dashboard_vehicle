import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import { useStore } from "../hooks/useStore";
import { toast } from "../hooks/useToast";
import { api } from "../services/api";
import { setState } from "../stores/store";
import type { Mission } from "../types";
import { IconFit, IconMaximize, IconMinimize, IconSatellite, IconTarget, IconTrash } from "./icons";

interface Props {
  mission: Mission | null;
  onMapClick?: (lat: number, lon: number) => void;
  onWaypointMoved?: (id: number, lat: number, lon: number) => void;
  editable: boolean;
}

type LayerType = "street" | "satellite" | "hybrid";

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
export function VehicleMap({ mission, onMapClick, onWaypointMoved, editable }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layers = useRef<{
    tiles: L.TileLayer | null; vehicle: L.Marker | null; home: L.Marker | null;
    route: L.Polyline; track: L.Polyline; histTrack: L.Polyline; wps: Map<number, L.Marker>;
  } | null>(null);
  const [follow, setFollow] = useState(true);
  const [isFullMap, setIsFullMap] = useState(false);
  const [layerType, setLayerType] = useState<LayerType>("street");

  const followRef = useRef(true);
  const centeredOnce = useRef(false);
  const cbRef = useRef({ onMapClick, onWaypointMoved, editable });
  cbRef.current = { onMapClick, onWaypointMoved, editable };

  const vehicle = useStore((s) => s.vehicle);
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
    const map = L.map(el, { zoomControl: true, attributionControl: true, preferCanvas: hasCanvas })
      .setView([settings?.home_lat ?? 16.0748, settings?.home_lon ?? 108.15], 16);
    map.zoomControl.setPosition("topleft");
    const route = L.polyline([], { color: "#1a4d8f", weight: 3, opacity: 0.9, dashArray: "6 6" }).addTo(map);
    const trackLine = L.polyline([], { color: "#157a3a", weight: 3, opacity: 0.95 }).addTo(map);
    const histTrack = L.polyline([], { color: "#7d8795", weight: 3, opacity: 0.8, dashArray: "2 6" }).addTo(map);
    layers.current = { tiles: null, vehicle: null, home: null, route, track: trackLine, histTrack, wps: new Map() };
    mapRef.current = map;

    map.on("click", (e: L.LeafletMouseEvent) => {
      if (cbRef.current.editable) cbRef.current.onMapClick?.(e.latlng.lat, e.latlng.lng);
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
      const cls = active
        ? (i + 1 < (mission?.current_waypoint ?? 0) ? "done" : i + 1 === mission?.current_waypoint ? "current" : "")
        : mission?.status === "COMPLETED" ? "done" : i === 0 ? "start" : "";
      const icon = L.divIcon({ className: "", html: `<div class="wp-icon ${cls}" title="${wp.name}">${i + 1}</div>`, iconSize: [24, 24], iconAnchor: [12, 12] });
      let m = ly.wps.get(wp.id);
      if (!m) {
        m = L.marker([wp.latitude, wp.longitude], { icon, draggable: editable }).addTo(map);
        m.on("dragend", () => {
          const ll = m!.getLatLng();
          cbRef.current.onWaypointMoved?.(wp.id, ll.lat, ll.lng);
        });
        m.bindTooltip(`${wp.name}`, { direction: "top", offset: [0, -12] });
        ly.wps.set(wp.id, m);
      } else {
        m.setLatLng([wp.latitude, wp.longitude]);
        m.setIcon(icon);
        if (editable) m.dragging?.enable(); else m.dragging?.disable();
        m.setTooltipContent(wp.name);
      }
    });
    ly.wps.forEach((m, id) => { if (!seen.has(id)) { m.remove(); ly.wps.delete(id); } });
    ly.route.setLatLngs(wps.map((w) => [w.latitude, w.longitude] as [number, number]));
  }, [mission, editable]);

  const fitRoute = () => {
    const map = mapRef.current;
    const pts = [...(mission?.waypoints ?? []).map((w) => [w.latitude, w.longitude] as [number, number])];
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

  const handleClearTrack = async () => {
    try {
      setState({ track: [], historyTrack: null });
      if (layers.current) {
        layers.current.track.setLatLngs([]);
        layers.current.histTrack.setLatLngs([]);
      }
      await api.telemetry.clearTrack();
      toast("info", "Đã xóa đường đã đi trên bản đồ");
    } catch {
      toast("info", "Đã xóa đường đã đi trên bản đồ");
    }
  };

  const hasTrack = track.length > 0 || (historyTrack !== null && historyTrack.length > 0);

  return (
    <div className={`map-wrap ${isFullMap ? "fullscreen" : ""}`}>
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

      <div className="map-hint">
        {editable ? "Click map to add waypoint · drag marker to move" : "Mission active — editing locked"}
        {" · "}{vehicle.latitude.toFixed(5)}, {vehicle.longitude.toFixed(5)}
      </div>
    </div>
  );
}

