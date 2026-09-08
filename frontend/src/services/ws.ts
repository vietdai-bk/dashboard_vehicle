// WebSocket client tự reconnect (backoff 1s → 10s), ping định kỳ, không reload page.
import { actions } from "../stores/store";
import type { Alert, ConnectionInfo, EventEntry, Mission, MissionHistoryEntry, Telemetry, VehicleState } from "../types";
import { auth } from "./auth";

type WsMessage =
  | { type: "snapshot"; data: Parameters<typeof actions.snapshot>[0] }
  | { type: "vehicle"; data: VehicleState }
  | { type: "telemetry"; data: Telemetry }
  | { type: "mission"; data: Mission }
  | { type: "connection"; data: ConnectionInfo }
  | { type: "event"; data: EventEntry }
  | { type: "alert"; data: Alert }
  | { type: "history"; data: MissionHistoryEntry }
  | { type: "settings"; data: unknown }
  | { type: "pong"; data: null };

class TelemetrySocket {
  private ws: WebSocket | null = null;
  private retry = 0;
  private timer: number | null = null;
  private ping: number | null = null;
  private stopped = true;
  onSettings: ((s: unknown) => void) | null = null;

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) window.clearTimeout(this.timer);
    if (this.ping) window.clearInterval(this.ping);
    this.ws?.close();
    this.ws = null;
  }

  private url(): string {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const token = auth.token ? `?token=${encodeURIComponent(auth.token)}` : "";
    return `${proto}://${location.host}/ws/telemetry${token}`;
  }

  private connect(): void {
    if (this.stopped) return;
    actions.wsStatus("connecting");
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      actions.wsStatus("open");
      this.ping = window.setInterval(() => ws.readyState === WebSocket.OPEN && ws.send("ping"), 15000);
    };
    ws.onmessage = (ev) => this.handle(ev.data as string);
    ws.onerror = () => {
      /* onclose sẽ xử lý reconnect */
    };
    ws.onclose = (ev) => {
      if (this.ping) window.clearInterval(this.ping);
      actions.wsStatus("closed");
      if (ev.code === 4401) {
        // token hết hạn/không hợp lệ: đăng xuất, không reconnect vô hạn
        auth.clear();
        window.dispatchEvent(new Event("vd:unauthorized"));
        return;
      }
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    const delay = Math.min(10000, 1000 * 2 ** this.retry++);
    this.timer = window.setTimeout(() => this.connect(), delay);
  }

  private handle(raw: string): void {
    let msg: WsMessage;
    try {
      msg = JSON.parse(raw) as WsMessage;
    } catch {
      return;
    }
    switch (msg.type) {
      case "snapshot": actions.snapshot(msg.data); break;
      case "vehicle": actions.vehicle(msg.data); break;
      case "telemetry": actions.telemetry(msg.data); break;
      case "mission": actions.mission(msg.data); break;
      case "connection": actions.connection(msg.data); break;
      case "event": actions.event(msg.data); break;
      case "alert": actions.alert(msg.data); break;
      case "history": actions.historyEntry(msg.data); break;
      case "settings": this.onSettings?.(msg.data); break;
      case "pong": break;
    }
  }
}

export const telemetrySocket = new TelemetrySocket();
