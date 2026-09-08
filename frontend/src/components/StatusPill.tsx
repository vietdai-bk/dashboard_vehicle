import { useStore } from "../hooks/useStore";

/** Trạng thái nguồn dữ liệu: MOCK ● ACTIVE / STM32 ● CONNECTED / UART ● DISCONNECTED */
export function ConnectionPill() {
  const connection = useStore((s) => s.connection);
  const ws = useStore((s) => s.wsStatus);
  const cls = ws !== "open" ? "off" : connection.connected ? "on" : "off";
  const label = ws === "connecting" ? "SERVER ● CONNECTING" : connection.label;
  return (
    <span className={`status-pill ${cls}`} title={connection.detail}>
      <span className="dot" />
      {label}
    </span>
  );
}

export function VehicleStateBadge({ large = false }: { large?: boolean }) {
  const state = useStore((s) => s.vehicle.state);
  const connected = useStore((s) => s.vehicle.connected);
  const map: Record<string, string> = {
    DISARMED: "neutral", ARMED: "warn", RUNNING: "ok pulse", PAUSED: "warn", STOPPED: "neutral", RTL: "info", ERROR: "danger",
  };
  if (!connected) return <span className={`badge danger ${large ? "lg" : ""}`}>DISCONNECTED</span>;
  return <span className={`badge ${map[state] ?? "neutral"} ${large ? "lg" : ""}`}>{state}</span>;
}

export function MissionStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    EMPTY: "neutral", READY: "info", UPLOADING: "warn pulse", UPLOADED: "info", RUNNING: "ok pulse", PAUSED: "warn",
    COMPLETED: "ok", STOPPED: "neutral", ERROR: "danger",
  };
  return <span className={`badge ${map[status] ?? "neutral"}`}>{status}</span>;
}
