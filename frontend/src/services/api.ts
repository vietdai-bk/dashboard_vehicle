import type {
  Alert, ApiResponse, AppSettings, ConnectionInfo, EventEntry, Mission, MissionHistoryEntry,
  SavedMission, SystemInfo, Telemetry, VehicleState, Waypoint,
} from "../types";
import { auth } from "./auth";

export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
  }
}

type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();
export const onUnauthorized = (fn: Listener): (() => void) => {
  unauthorizedListeners.add(fn);
  return () => unauthorizedListeners.delete(fn);
};

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth.token) headers.Authorization = `Bearer ${auth.token}`;
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError("NETWORK", "Cannot reach server", 0);
  }
  let json: ApiResponse<T> | null = null;
  try {
    json = (await res.json()) as ApiResponse<T>;
  } catch {
    /* body rỗng */
  }
  if (res.status === 401) {
    unauthorizedListeners.forEach((fn) => fn());
  }
  if (!res.ok || !json || !json.ok) {
    const err = json?.error ?? { code: `HTTP_${res.status}`, message: res.statusText || "Request failed" };
    throw new ApiError(err.code, err.message, res.status);
  }
  return json.data;
}

const get = <T>(url: string) => request<T>("GET", url);
const post = <T>(url: string, body?: unknown) => request<T>("POST", url, body);
const put = <T>(url: string, body?: unknown) => request<T>("PUT", url, body);
const del = <T>(url: string) => request<T>("DELETE", url);

export const api = {
  auth: {
    status: () => get<{ auth_enabled: boolean; authenticated: boolean; username: string | null }>("/api/auth/status"),
    login: (username: string, password: string) =>
      post<{ token: string; username: string }>("/api/auth/login", { username, password }),
    logout: () => post<{ logged_out: boolean }>("/api/auth/logout"),
  },
  vehicle: {
    state: () => get<VehicleState>("/api/vehicle/state"),
    connection: () => get<ConnectionInfo>("/api/vehicle/connection"),
    connect: (source?: string, port?: string, baudrate?: number) =>
      post<ConnectionInfo>("/api/vehicle/connect", { source, port, baudrate }),
    disconnect: () => post<ConnectionInfo>("/api/vehicle/disconnect"),
    arm: () => post<{ message: string }>("/api/vehicle/arm"),
    disarm: () => post<{ message: string }>("/api/vehicle/disarm"),
    rtl: () => post<{ message: string }>("/api/vehicle/rtl"),
  },
  mission: {
    get: () => get<Mission>("/api/mission"),
    clear: () => del<Mission>("/api/mission"),
    create: () => post<Mission>("/api/mission/new"),
    rename: (name: string) => put<Mission>("/api/mission/name", { name }),
    addWaypoint: (latitude: number, longitude: number, altitude?: number) =>
      post<{ waypoint: Waypoint; mission: Mission }>("/api/mission/waypoints", { latitude, longitude, altitude }),
    updateWaypoint: (id: number, patch: Partial<Pick<Waypoint, "latitude" | "longitude" | "altitude" | "name">>) =>
      put<{ waypoint: Waypoint; mission: Mission }>(`/api/mission/waypoints/${id}`, patch),
    deleteWaypoint: (id: number) => del<Mission>(`/api/mission/waypoints/${id}`),
    reorder: (ids: number[]) => put<Mission>("/api/mission/waypoints/reorder", { ids }),
    upload: () => post<Mission>("/api/mission/upload"),
    start: () => post<Mission>("/api/mission/start"),
    stop: () => post<Mission>("/api/mission/stop"),
    pause: () => post<Mission>("/api/mission/pause"),
    resume: () => post<Mission>("/api/mission/resume"),
    abort: () => post<Mission>("/api/mission/abort"),
    saved: () => get<SavedMission[]>("/api/mission/saved"),
    save: (name?: string) => post<SavedMission>("/api/mission/saved", name ? { name } : undefined),
    load: (id: string) => post<Mission>(`/api/mission/saved/${id}/load`),
    deleteSaved: (id: string) => del<{ deleted: string }>(`/api/mission/saved/${id}`),
    history: () => get<MissionHistoryEntry[]>("/api/mission/history"),
    clearHistory: () => del<MissionHistoryEntry[]>("/api/mission/history"),
  },
  telemetry: {
    current: () => get<Telemetry>("/api/telemetry"),
    history: (seconds: number) => get<Telemetry[]>(`/api/telemetry/history?seconds=${seconds}`),
    track: () => get<[number, number][]>("/api/track"),
    clearTrack: () => del<unknown>("/api/track"),
    events: (limit = 300) => get<EventEntry[]>(`/api/events?limit=${limit}`),
    clearEvents: () => del<EventEntry[]>("/api/events"),
    alerts: () => get<Alert[]>("/api/alerts"),
    ackAlert: (id: number) => post<Alert>(`/api/alerts/${id}/ack`),
  },
  config: {
    get: () => get<{ settings: AppSettings; editable: string[] }>("/api/config"),
    update: (patch: Partial<AppSettings>) =>
      put<{ settings: AppSettings; changed: Partial<AppSettings> }>("/api/config", patch),
    system: () => get<SystemInfo>("/api/config/system"),
  },
};
