// Đồng bộ với backend/models.py. Frontend không biết dữ liệu đến từ mock hay STM32.

export type VehicleStatus = "DISARMED" | "ARMED" | "RUNNING" | "PAUSED" | "STOPPED" | "RTL" | "ERROR";
export type MissionStatus =
  | "EMPTY" | "READY" | "UPLOADING" | "UPLOADED" | "RUNNING" | "PAUSED" | "COMPLETED" | "STOPPED" | "ERROR";
export type AlertLevel = "info" | "warning" | "critical";

export interface ApiResponse<T> {
  ok: boolean;
  data: T;
  error: { code: string; message: string } | null;
}

export interface Waypoint {
  id: number;
  latitude: number;
  longitude: number;
  order: number;
  altitude: number;
  name: string;
  telemetry?: Telemetry;
  reached_at?: number;
}


export interface VehicleState {
  connected: boolean;
  source: string;
  armed: boolean;
  state: VehicleStatus;
  latitude: number;
  longitude: number;
  altitude: number;
  heading: number;
  speed: number;
  battery: number;
  voltage: number;
  satellites: number;
  current_waypoint: number;
  total_waypoints: number;
  distance_travelled_m: number;
  home_latitude: number;
  home_longitude: number;
  last_update: number;
  error_message: string;
}

export interface Telemetry {
  timestamp: number;
  temperature: number;
  humidity: number;
  co2: number;
  co: number;
  pm25: number;
  tvoc: number;
  nox: number;
  aqi: number;
}

export interface Mission {
  id: string;
  name: string;
  waypoints: Waypoint[];
  status: MissionStatus;
  uploaded: boolean;
  current_waypoint: number;
  completed: number;
  progress: number;
  distance_total_m: number;
  distance_remaining_m: number;
  started_at: number | null;
  ended_at: number | null;
  upload_message: string;
  route_points?: [number, number][];
}


export interface SavedMission {
  id: string;
  name: string;
  waypoints: Waypoint[];
  created_at: number;
  updated_at: number;
}

export interface MissionHistoryEntry {
  id: string;
  mission_id: string;
  name: string;
  status: MissionStatus;
  started_at: number;
  ended_at: number;
  duration_s: number;
  waypoints_total: number;
  waypoints_completed: number;
  distance_m: number;
  battery_start: number;
  battery_end: number;
  track: [number, number][];
}

export interface EventEntry {
  id: number;
  timestamp: number;
  level: string;
  category: string;
  message: string;
}

export interface Alert {
  id: number;
  key: string;
  level: AlertLevel;
  message: string;
  timestamp: number;
  active: boolean;
  acknowledged: boolean;
}

export interface ConnectionInfo {
  source: string;
  connected: boolean;
  label: string;
  detail: string;
}

export interface AppSettings {
  data_source: string;
  uart_port: string;
  uart_baudrate: number;
  uart_timeout_s: number;
  server_host: string;
  server_port: number;
  log_level: string;
  auth_enabled: boolean;
  auth_username: string;
  telemetry_rate_hz: number;
  vehicle_name: string;
  home_lat: number;
  home_lon: number;
  mock_cruise_speed_mps: number;
  mock_turn_rate_dps: number;
  mock_battery_drain_pct_per_min: number;
  mock_initial_battery: number;
  acceptance_radius_m: number;
  battery_warn_pct: number;
  battery_critical_pct: number;
  geofence_radius_m: number;
  auto_rtl_on_abort: boolean;
  map_tiles: string;
  map_attribution: string;
  telemetry_history_size: number;
  event_log_size: number;
  track_max_points: number;
}

export interface SystemInfo {
  server_ip: string;
  server_port: number;
  version: string;
  uptime_s: number;
  ws_clients: number;
  data_source: string;
  python: string;
}

export type WsStatus = "connecting" | "open" | "closed";

// Định nghĩa sensor: thêm sensor mới = thêm một dòng ở đây (+ trường trong Telemetry)
export interface SensorDef {
  key: keyof Telemetry;
  label: string;
  unit: string;
  decimals: number;
  group: "environment" | "air";
  warn?: [number, number]; // ngoài khoảng => WARN
}

export const SENSORS: SensorDef[] = [
  { key: "temperature", label: "Temperature", unit: "°C", decimals: 1, group: "environment", warn: [0, 45] },
  { key: "humidity", label: "Humidity", unit: "%", decimals: 0, group: "environment", warn: [20, 95] },
  { key: "co2", label: "CO₂", unit: "ppm", decimals: 0, group: "air", warn: [0, 1000] },
  { key: "co", label: "CO", unit: "ppm", decimals: 2, group: "air", warn: [0, 9] },
  { key: "pm25", label: "PM2.5", unit: "µg/m³", decimals: 1, group: "air", warn: [0, 35] },
  { key: "tvoc", label: "TVOC", unit: "ppb", decimals: 0, group: "air", warn: [0, 400] },
  { key: "nox", label: "NOx", unit: "ppb", decimals: 0, group: "air", warn: [0, 100] },
  { key: "aqi", label: "AQI", unit: "", decimals: 0, group: "air", warn: [0, 100] },
];
