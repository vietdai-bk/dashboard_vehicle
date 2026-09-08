// Store ngoài React (useSyncExternalStore). Mọi dữ liệu realtime đi qua đây.
import type {
  Alert, AppSettings, ConnectionInfo, EventEntry, Mission, MissionHistoryEntry, Telemetry, VehicleState, WsStatus,
} from "../types";

export interface AppState {
  vehicle: VehicleState;
  telemetry: Telemetry;
  mission: Mission | null;
  connection: ConnectionInfo;
  wsStatus: WsStatus;
  track: [number, number][];
  historyTrack: [number, number][] | null; // track của một mission trong lịch sử để xem lại trên map
  sensorHistory: Telemetry[];
  alerts: Alert[];
  events: EventEntry[];
  history: MissionHistoryEntry[];
  settings: AppSettings | null;
  speedStats: { max: number; sum: number; n: number };
  lastMessageAt: number;
}

export const MAX_SENSOR_POINTS = 3600; // 1 mẫu/giây => 1 giờ
export const MAX_TRACK_POINTS = 5000;
export const MAX_EVENTS = 500;

const emptyVehicle: VehicleState = {
  connected: false, source: "mock", armed: false, state: "DISARMED", latitude: 0, longitude: 0, altitude: 0,
  heading: 0, speed: 0, battery: 0, voltage: 0, satellites: 0, current_waypoint: 0, total_waypoints: 0,
  distance_travelled_m: 0, home_latitude: 0, home_longitude: 0, last_update: 0, error_message: "",
};
const emptyTelemetry: Telemetry = {
  timestamp: 0, temperature: 0, humidity: 0, pressure: 0, co2: 0, pm25: 0, pm10: 0, light: 0, gas: 0,
  imu_roll: 0, imu_pitch: 0, imu_yaw: 0,
};

let state: AppState = {
  vehicle: emptyVehicle,
  telemetry: emptyTelemetry,
  mission: null,
  connection: { source: "none", connected: false, label: "CONNECTING…", detail: "" },
  wsStatus: "connecting",
  track: [],
  historyTrack: null,
  sensorHistory: [],
  alerts: [],
  events: [],
  history: [],
  settings: null,
  speedStats: { max: 0, sum: 0, n: 0 },
  lastMessageAt: 0,
};

const listeners = new Set<() => void>();
export const getState = (): AppState => state;
export const subscribe = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)): void {
  const p = typeof patch === "function" ? patch(state) : patch;
  state = { ...state, ...p };
  listeners.forEach((fn) => fn());
}

const distM = (a: [number, number], b: [number, number]): number => {
  const dLat = (b[0] - a[0]) * 111320;
  const dLon = (b[1] - a[1]) * 111320 * Math.cos((a[0] * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
};

// ---- reducers cho từng loại message WS ----------------------------------------------
export const actions = {
  vehicle(v: VehicleState): void {
    setState((s) => {
      let track = s.track;
      if (v.latitude !== 0 || v.longitude !== 0) {
        const pt: [number, number] = [v.latitude, v.longitude];
        const last = track[track.length - 1];
        if (!last || distM(last, pt) >= 0.5) {
          track = track.length >= MAX_TRACK_POINTS ? [...track.slice(-MAX_TRACK_POINTS + 1), pt] : [...track, pt];
        }
      }
      const running = v.state === "RUNNING";
      const ss = running
        ? { max: Math.max(s.speedStats.max, v.speed), sum: s.speedStats.sum + v.speed, n: s.speedStats.n + 1 }
        : s.speedStats;
      return { vehicle: v, track, speedStats: ss, lastMessageAt: Date.now() };
    });
  },
  telemetry(t: Telemetry): void {
    setState((s) => {
      const last = s.sensorHistory[s.sensorHistory.length - 1];
      let hist = s.sensorHistory;
      if (!last || t.timestamp - last.timestamp >= 0.95) {
        hist = hist.length >= MAX_SENSOR_POINTS ? [...hist.slice(-MAX_SENSOR_POINTS + 1), t] : [...hist, t];
      }
      return { telemetry: t, sensorHistory: hist, lastMessageAt: Date.now() };
    });
  },
  mission(m: Mission): void {
    setState((s) => {
      const restarted = m.started_at !== null && m.started_at !== s.mission?.started_at && m.status === "RUNNING";
      return {
        mission: m,
        track: restarted ? [] : s.track,
        speedStats: restarted ? { max: 0, sum: 0, n: 0 } : s.speedStats,
      };
    });
  },
  connection(c: ConnectionInfo): void {
    setState({ connection: c });
  },
  event(e: EventEntry): void {
    setState((s) => ({ events: [e, ...s.events].slice(0, MAX_EVENTS) }));
  },
  alert(a: Alert): void {
    setState((s) => {
      const rest = s.alerts.filter((x) => x.id !== a.id);
      return { alerts: [a, ...rest].sort((x, y) => y.timestamp - x.timestamp).slice(0, 200) };
    });
  },
  historyEntry(h: MissionHistoryEntry): void {
    setState((s) => ({ history: [h, ...s.history.filter((x) => x.id !== h.id)] }));
  },
  snapshot(d: {
    vehicle: VehicleState; telemetry: Telemetry; mission: Mission | null; connection: ConnectionInfo;
    track: [number, number][]; alerts: Alert[];
  }): void {
    setState((s) => ({
      vehicle: d.vehicle,
      telemetry: d.telemetry,
      mission: d.mission,
      connection: d.connection,
      track: d.track.length ? d.track : s.track,
      alerts: d.alerts.length ? d.alerts : s.alerts,
      lastMessageAt: Date.now(),
    }));
  },
  wsStatus(ws: WsStatus): void {
    setState((s) => ({
      wsStatus: ws,
      // mất WebSocket => coi như mất realtime, hiển thị DISCONNECTED cho tới khi có snapshot mới
      connection: ws === "open" ? s.connection : { ...s.connection, connected: false, label: "SERVER ● DISCONNECTED" },
    }));
  },
};
