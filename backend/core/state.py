"""VehicleStateStore — nguồn sự thật duy nhất về trạng thái vehicle.

Nhận packet từ provider (mock hoặc UART — không phân biệt), cập nhật state,
đánh giá cảnh báo, và broadcast qua WebSocket.
"""
from __future__ import annotations

import asyncio
import logging
import math
import time
from collections import deque
from typing import TYPE_CHECKING, Any, Optional

from ..config import settings
from ..models import ConnectionInfo, Telemetry, VehicleState
from ..telemetry.provider import TelemetryProvider
from .events import AlertManager, EventLog
from .websocket import manager as ws_manager

if TYPE_CHECKING:
    from ..mission.manager import MissionManager

log = logging.getLogger("state")

# Chuyển trạng thái hợp lệ của vehicle (safety state machine).
VALID_TRANSITIONS: dict[str, set[str]] = {
    "DISARMED": {"ARMED", "ERROR"},
    "ARMED": {"DISARMED", "RUNNING", "RTL", "ERROR"},
    "RUNNING": {"PAUSED", "STOPPED", "ARMED", "RTL", "DISARMED", "ERROR"},
    "PAUSED": {"RUNNING", "STOPPED", "ARMED", "RTL", "DISARMED", "ERROR"},
    "STOPPED": {"ARMED", "DISARMED", "RUNNING", "ERROR"},
    "RTL": {"ARMED", "DISARMED", "STOPPED", "ERROR"},
    "ERROR": {"DISARMED", "ARMED"},
}


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * 6371000.0 * math.asin(math.sqrt(a))


class VehicleStateStore:
    def __init__(self) -> None:
        self.vehicle = VehicleState(source=settings.data_source)
        self.telemetry = Telemetry()
        self.telemetry_history: deque[Telemetry] = deque(maxlen=settings.telemetry_history_size)
        self.track: deque[list[float]] = deque(maxlen=settings.track_max_points)
        self.provider: Optional[TelemetryProvider] = None
        self.mission: Optional["MissionManager"] = None
        self.events = EventLog(ws_manager.broadcast_nowait)
        self.alerts = AlertManager(ws_manager.broadcast_nowait, self.events)
        self.started_at = time.time()
        self._watchdog: Optional[asyncio.Task[None]] = None
        self._last_connected: Optional[bool] = None
        self._last_sensor_sample = 0.0
        self._geofence_state = False
        self._last_ack_time = 0.0
        self._last_ack_state: Optional[str] = None

    # ------------------------------------------------------------------ provider
    async def set_provider(self, provider: TelemetryProvider) -> None:
        if self.provider is not None:
            await self.provider.stop()
        self.provider = provider
        provider.bind(asyncio.get_running_loop(), self.apply_packet)
        self.vehicle.source = provider.kind
        self.vehicle.connected = False
        try:
            await provider.start()
        except Exception as exc:  # noqa: BLE001 — ví dụ cổng UART không tồn tại
            self.vehicle.error_message = str(exc)
            self.events.add("ERROR", "system", f"Provider {provider.kind} failed to start: {exc}")
            raise
        # mock: kết nối ngay khi vòng lặp chạy; UART: chờ packet đầu tiên
        self.vehicle.connected = provider.connected
        if self.vehicle.connected:
            self.vehicle.last_update = time.time()
        self.events.add("INFO", "system", f"Data source: {provider.label} ({provider.detail})")
        self._push_connection()
        self.broadcast_vehicle()
        if self._watchdog is None:
            self._watchdog = asyncio.create_task(self._watchdog_loop(), name="link-watchdog")

    async def stop_provider(self) -> None:
        if self.provider is not None:
            await self.provider.stop()
            self.events.add("INFO", "system", f"Data source {self.provider.label} stopped")
            self.provider = None
        self.vehicle.connected = False
        self._push_connection()
        self.broadcast_vehicle()

    async def shutdown(self) -> None:
        if self._watchdog:
            self._watchdog.cancel()
        if self.provider:
            await self.provider.stop()

    def connection_info(self) -> ConnectionInfo:
        if self.provider is None:
            return ConnectionInfo(source="none", connected=False, label="NO SOURCE ● OFFLINE")
        if self.provider.kind == "mock":
            label = "MOCK ● ACTIVE" if self.provider.connected else "MOCK ● STOPPED"
        else:
            connected = self.provider.connected and self.vehicle.connected
            label = "STM32 ● CONNECTED" if connected else "UART ● DISCONNECTED"
        return ConnectionInfo(source=self.provider.kind, connected=self.vehicle.connected,
                              label=label, detail=self.provider.detail)

    # ------------------------------------------------------------------ packets
    def apply_packet(self, packet: dict[str, Any]) -> None:
        """Điểm vào duy nhất cho mọi dữ liệu từ vehicle."""
        ptype = packet.get("type")
        now = time.time()
        self.vehicle.last_update = now
        if not self.vehicle.connected:
            self.vehicle.connected = True
            self._push_connection()
        try:
            if ptype == "telemetry":
                self._apply_telemetry(packet)
            elif ptype == "sensor":
                self._apply_sensor(packet)
            elif ptype == "mission" and self.mission is not None:
                self.mission.on_progress(packet)
            elif ptype == "log":
                self.events.add(str(packet.get("level", "INFO")), "vehicle", str(packet.get("message", "")))
            elif ptype == "ack":
                log.debug("ACK %s ok=%s %s", packet.get("command"), packet.get("ok"), packet.get("message"))
        except Exception:  # noqa: BLE001
            log.exception("Failed to apply packet %s", ptype)

    def _apply_telemetry(self, p: dict[str, Any]) -> None:
        v = self.vehicle
        prev_state = v.state
        mapping = {"lat": "latitude", "lon": "longitude", "heading": "heading", "speed": "speed",
                   "battery": "battery", "voltage": "voltage", "altitude": "altitude",
                   "satellites": "satellites", "current_waypoint": "current_waypoint",
                   "total_waypoints": "total_waypoints", "distance_travelled": "distance_travelled_m",
                   "home_lat": "home_latitude", "home_lon": "home_longitude"}
        for src, dst in mapping.items():
            if src in p:
                setattr(v, dst, p[src])
        if "armed" in p:
            if time.time() - self._last_ack_time > 0.4 or bool(p["armed"]) == v.armed:
                v.armed = bool(p["armed"])
        if "state" in p and p["state"] in VALID_TRANSITIONS:
            new_state = p["state"]
            if time.time() - self._last_ack_time <= 0.4 and self._last_ack_state is not None and new_state != self._last_ack_state:
                pass
            else:
                if new_state != prev_state:
                    if new_state not in VALID_TRANSITIONS[prev_state]:
                        log.warning("Vehicle reported unexpected transition %s -> %s", prev_state, new_state)
                    self.events.add("INFO", "vehicle", f"Vehicle state {prev_state} → {new_state}")
                v.state = new_state
        v.error_message = "" if v.state != "ERROR" else v.error_message or "Vehicle reported ERROR"
        self._append_track(v.latitude, v.longitude)
        self._evaluate_alerts()
        self.broadcast_vehicle()

    def apply_ack(self, command: str) -> None:
        """Vehicle đã ACK lệnh: cập nhật state ngay, không chờ packet telemetry kế tiếp.
        Tránh race ARM -> START trong khoảng giữa hai packet."""
        v = self.vehicle
        transitions = {"ARM": (True, "ARMED"), "DISARM": (False, "DISARMED"), "START": (None, "RUNNING"),
                       "PAUSE": (None, "PAUSED"), "RESUME": (None, "RUNNING"), "STOP": (None, "STOPPED"),
                       "RTL": (None, "RTL")}
        if command not in transitions:
            return
        armed, state = transitions[command]
        self._last_ack_state = state
        self._last_ack_time = time.time()
        if armed is not None:
            v.armed = armed
        if state != v.state:
            self.events.add("INFO", "vehicle", f"Vehicle state {v.state} → {state}")
            v.state = state  # type: ignore[assignment]
        self.broadcast_vehicle()

    def _apply_sensor(self, p: dict[str, Any]) -> None:
        data = {k: p[k] for k in Telemetry.model_fields if k in p}
        self.telemetry = Telemetry(**data)
        now = self.telemetry.timestamp
        if now - self._last_sensor_sample >= 1.0:
            self._last_sensor_sample = now
            self.telemetry_history.append(self.telemetry)
        ws_manager.broadcast_nowait({"type": "telemetry", "data": self.telemetry.model_dump()})

    def _append_track(self, lat: float, lon: float) -> None:
        if lat == 0 and lon == 0:
            return
        if self.track:
            last = self.track[-1]
            if haversine_m(last[0], last[1], lat, lon) < 0.5:
                return
        self.track.append([round(lat, 7), round(lon, 7)])

    def reset_track(self) -> None:
        self.track.clear()

    # ------------------------------------------------------------------ alerts
    def _evaluate_alerts(self) -> None:
        v = self.vehicle
        if v.battery <= settings.battery_critical_pct:
            self.alerts.raise_alert("battery", "critical", f"Battery critical: {v.battery:.0f}%")
        elif v.battery <= settings.battery_warn_pct:
            self.alerts.raise_alert("battery", "warning", f"Battery low: {v.battery:.0f}%")
        else:
            self.alerts.clear("battery")
        if v.home_latitude and v.home_longitude:
            dist = haversine_m(v.home_latitude, v.home_longitude, v.latitude, v.longitude)
            if dist > settings.geofence_radius_m:
                self.alerts.raise_alert("geofence", "warning",
                                        f"Geofence breach: {dist:.0f} m from home (limit {settings.geofence_radius_m:.0f} m)")
            else:
                self.alerts.clear("geofence")
        if v.state == "ERROR":
            self.alerts.raise_alert("vehicle_error", "critical", v.error_message or "Vehicle in ERROR state")
        else:
            self.alerts.clear("vehicle_error")

    async def _watchdog_loop(self) -> None:
        """Phát hiện mất link: không có packet trong uart_timeout_s."""
        while True:
            await asyncio.sleep(0.5)
            if self.provider is None:
                continue
            timeout = settings.uart_timeout_s
            alive = (time.time() - self.vehicle.last_update) < timeout
            if self.vehicle.connected and not alive:
                self.vehicle.connected = False
                self.alerts.raise_alert("link", "critical", f"Link lost: no telemetry for {timeout:.0f}s")
                self._push_connection()
                self.broadcast_vehicle()
            elif alive and self.vehicle.connected:
                self.alerts.clear("link")

    # ------------------------------------------------------------------ broadcast
    def broadcast_vehicle(self) -> None:
        ws_manager.broadcast_nowait({"type": "vehicle", "data": self.vehicle.model_dump()})

    def _push_connection(self) -> None:
        info = self.connection_info()
        if self._last_connected != info.connected:
            self._last_connected = info.connected
            self.events.add("INFO" if info.connected else "WARNING", "system", info.label)
        ws_manager.broadcast_nowait({"type": "connection", "data": info.model_dump()})

    def snapshot(self) -> dict[str, Any]:
        return {
            "vehicle": self.vehicle.model_dump(),
            "telemetry": self.telemetry.model_dump(),
            "connection": self.connection_info().model_dump(),
            "mission": self.mission.current.model_dump() if self.mission else None,
            "track": list(self.track),
            "alerts": [a.model_dump() for a in self.alerts.list(active_only=True)],
            "server_time": time.time(),
        }


store = VehicleStateStore()
