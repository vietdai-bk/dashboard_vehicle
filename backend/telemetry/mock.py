"""MockTelemetryProvider — giả lập STM32 + vehicle.

Không random hoàn toàn: vehicle có vị trí, heading, tốc độ, pin, và chạy qua
waypoint theo động học đơn giản (quay đầu có giới hạn, tăng/giảm tốc, giảm tốc
khi tới gần waypoint). Sensor trôi theo sin + nhiễu nhỏ.
Mock phát ra CHÍNH XÁC các packet như STM32 (qua parse_packet) và giả lập ACK.
"""
from __future__ import annotations

import asyncio
import logging
import math
import random
import time
from typing import Any, Optional

from ..config import settings
from ..hardware.protocol import parse_packet
from .provider import CommandResult, TelemetryProvider

log = logging.getLogger("mock")

EARTH_R = 6371000.0


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_R * math.asin(math.sqrt(a))


def bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    x = math.sin(dl) * math.cos(p2)
    y = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def move(lat: float, lon: float, heading: float, dist_m: float) -> tuple[float, float]:
    d = dist_m / EARTH_R
    b = math.radians(heading)
    p1, l1 = math.radians(lat), math.radians(lon)
    p2 = math.asin(math.sin(p1) * math.cos(d) + math.cos(p1) * math.sin(d) * math.cos(b))
    l2 = l1 + math.atan2(math.sin(b) * math.sin(d) * math.cos(p1), math.cos(d) - math.sin(p1) * math.sin(p2))
    return math.degrees(p2), math.degrees(l2)


class MockTelemetryProvider(TelemetryProvider):
    kind = "mock"
    label = "MOCK"

    DT = 0.1  # bước mô phỏng (s)

    def __init__(self) -> None:
        super().__init__()
        self._task: Optional[asyncio.Task[None]] = None
        self._running = False
        # --- trạng thái vehicle giả lập ---
        self.lat = settings.home_lat
        self.lon = settings.home_lon
        self.home = (settings.home_lat, settings.home_lon)
        self.heading = 45.0
        self.speed_mps = 0.0
        self.altitude = 0.0
        self.battery = settings.mock_initial_battery
        self.armed = False
        self.state = "DISARMED"           # DISARMED ARMED RUNNING PAUSED STOPPED RTL ERROR
        self.waypoints: list[dict[str, Any]] = []
        self.wp_index = 0
        self.completed = 0
        self.mission_state = "EMPTY"
        self.distance_travelled = 0.0
        self.satellites = 11
        self._t = 0.0
        self._last_mission_emit = 0.0
        self._last_sensor_emit = 0.0
        self._last_tele_emit = 0.0
        self._last_heartbeat = 0.0

    # ------------------------------------------------------------------ lifecycle
    @property
    def connected(self) -> bool:
        return self._running

    @property
    def detail(self) -> str:
        return "simulated STM32"

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._loop_task(), name="mock-vehicle")
        log.info("Mock telemetry provider started (home %.5f, %.5f)", self.lat, self.lon)
        self._emit({"type": "log", "level": "INFO", "message": "Mock vehicle online"})

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        log.info("Mock telemetry provider stopped")

    def _emit(self, packet: dict[str, Any]) -> None:
        """Đi qua parse_packet để chắc chắn mock tuân thủ đúng protocol như STM32."""
        import json
        parsed = parse_packet(json.dumps(packet))
        if parsed is not None:
            self.emit(parsed)

    # ------------------------------------------------------------------ commands
    async def send_command(self, command: str, params: Optional[dict[str, Any]] = None) -> CommandResult:
        params = params or {}
        await asyncio.sleep(0.15)  # giả lập độ trễ UART + xử lý trên STM32
        log.info("Mock received command %s %s", command, {k: v for k, v in params.items() if k != "waypoints"})
        handler = getattr(self, f"_cmd_{command.lower()}", None)
        if handler is None:
            return self._ack(command, False, f"Unknown command {command}")
        result: CommandResult = handler(params)
        return self._ack(command, result.ok, result.message, result.data)

    def _ack(self, command: str, ok: bool, message: str, data: Optional[dict[str, Any]] = None) -> CommandResult:
        self._emit({"type": "ack", "command": command, "ok": ok, "message": message})
        return CommandResult(ok, message, data)

    def _cmd_arm(self, _: dict[str, Any]) -> CommandResult:
        if self.state in ("RUNNING", "PAUSED", "RTL"):
            return CommandResult(False, "Cannot ARM while mission active")
        if self.battery < settings.battery_critical_pct:
            return CommandResult(False, f"Battery critical ({self.battery:.0f}%), refuse to arm")
        self.armed = True
        self.state = "ARMED"
        return CommandResult(True, "Vehicle armed")

    def _cmd_disarm(self, _: dict[str, Any]) -> CommandResult:
        if self.state in ("RUNNING", "PAUSED", "RTL"):
            # xử lý an toàn: dừng mission trước khi disarm
            self._finish_mission("STOPPED")
        self.armed = False
        self.state = "DISARMED"
        self.speed_mps = 0.0
        return CommandResult(True, "Vehicle disarmed")

    def _cmd_upload_mission(self, params: dict[str, Any]) -> CommandResult:
        wps = params.get("waypoints") or []
        if not wps:
            return CommandResult(False, "Empty mission rejected")
        if self.state in ("RUNNING", "PAUSED"):
            return CommandResult(False, "Cannot upload while mission running")
        for wp in wps:
            if not (-90 <= wp["lat"] <= 90 and -180 <= wp["lon"] <= 180):
                return CommandResult(False, f"Invalid waypoint {wp.get('id')}")
        self.waypoints = list(wps)
        self.wp_index = 0
        self.completed = 0
        self.mission_state = "UPLOADED"
        return CommandResult(True, f"{len(wps)} waypoints stored", {"count": len(wps)})

    def _cmd_start(self, _: dict[str, Any]) -> CommandResult:
        if not self.armed:
            return CommandResult(False, "Vehicle not armed")
        if not self.waypoints:
            return CommandResult(False, "No mission uploaded")
        if self.state == "RUNNING":
            return CommandResult(False, "Mission already running")
        self.wp_index = 0
        self.completed = 0
        self.state = "RUNNING"
        self.mission_state = "RUNNING"
        self._emit_mission(force=True)
        return CommandResult(True, "Mission started")

    def _cmd_stop(self, _: dict[str, Any]) -> CommandResult:
        if self.state not in ("RUNNING", "PAUSED", "RTL"):
            return CommandResult(False, "No active mission to stop")
        self._finish_mission("STOPPED")
        return CommandResult(True, "Mission stopped")

    def _cmd_pause(self, _: dict[str, Any]) -> CommandResult:
        if self.state != "RUNNING":
            return CommandResult(False, "Mission is not running")
        self.state = "PAUSED"
        self.mission_state = "PAUSED"
        self._emit_mission(force=True)
        return CommandResult(True, "Mission paused")

    def _cmd_resume(self, _: dict[str, Any]) -> CommandResult:
        if self.state != "PAUSED":
            return CommandResult(False, "Mission is not paused")
        self.state = "RUNNING"
        self.mission_state = "RUNNING"
        self._emit_mission(force=True)
        return CommandResult(True, "Mission resumed")

    def _cmd_rtl(self, _: dict[str, Any]) -> CommandResult:
        if not self.armed:
            return CommandResult(False, "Vehicle not armed")
        if self.state in ("RUNNING", "PAUSED"):
            self._finish_mission("STOPPED", emit=True)
        self.state = "RTL"
        return CommandResult(True, "Returning to launch")

    def _finish_mission(self, final: str, emit: bool = True) -> None:
        self.mission_state = final
        self.state = "ARMED" if self.armed else "DISARMED"
        self.speed_mps = 0.0
        if emit:
            self._emit_mission(force=True)

    # ------------------------------------------------------------------ simulation
    async def _loop_task(self) -> None:
        try:
            while self._running:
                self._step(self.DT)
                await asyncio.sleep(self.DT)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 — mock không được làm chết server
            log.exception("Mock loop crashed; restarting")
            self.state = "ERROR"
            await asyncio.sleep(1)
            self.state = "ARMED" if self.armed else "DISARMED"
            self._task = asyncio.create_task(self._loop_task(), name="mock-vehicle")

    def _step(self, dt: float) -> None:
        self._t += dt
        cruise = settings.mock_cruise_speed_mps
        turn_rate = settings.mock_turn_rate_dps
        accept = settings.acceptance_radius_m

        target: Optional[tuple[float, float]] = None
        if self.state == "RUNNING" and self.wp_index < len(self.waypoints):
            wp = self.waypoints[self.wp_index]
            target = (wp["lat"], wp["lon"])
        elif self.state == "RTL":
            target = self.home

        if target is not None:
            dist = haversine_m(self.lat, self.lon, *target)
            desired = bearing_deg(self.lat, self.lon, *target)
            # quay đầu có giới hạn tốc độ
            diff = (desired - self.heading + 540) % 360 - 180
            step = max(-turn_rate * dt, min(turn_rate * dt, diff))
            self.heading = (self.heading + step) % 360
            # tốc độ: tăng dần, chậm lại khi gần đích, chậm hơn khi đang quay gắt
            target_speed = min(cruise, max(1.0, dist / 3.0))
            if abs(diff) > 45:
                target_speed = min(target_speed, cruise * 0.4)
            self.speed_mps += max(-3.0 * dt, min(2.0 * dt, target_speed - self.speed_mps))
            travelled = self.speed_mps * dt
            self.lat, self.lon = move(self.lat, self.lon, self.heading, travelled)
            self.distance_travelled += travelled
            # pin giảm theo thời gian, nhanh hơn khi chạy nhanh
            self.battery -= settings.mock_battery_drain_pct_per_min / 60.0 * dt * (1 + self.speed_mps / cruise)
            if dist <= accept:
                if self.state == "RUNNING":
                    self.completed += 1
                    self.wp_index += 1
                    self._emit({"type": "log", "level": "INFO",
                                "message": f"Reached waypoint {self.completed}/{len(self.waypoints)}"})
                    if self.wp_index >= len(self.waypoints):
                        self._finish_mission("COMPLETED")
                    else:
                        self._emit_mission(force=True)
                else:  # RTL về tới home
                    self.state = "ARMED"
                    self.speed_mps = 0.0
                    self._emit({"type": "log", "level": "INFO", "message": "Arrived at launch point"})
        else:
            # đứng yên: giảm tốc về 0, pin tự xả nhẹ khi ARMED, GPS jitter nhỏ
            self.speed_mps = max(0.0, self.speed_mps - 3.0 * dt)
            if self.armed:
                self.battery -= settings.mock_battery_drain_pct_per_min / 60.0 * dt * 0.2
            self.lat += random.gauss(0, 1.5e-7)
            self.lon += random.gauss(0, 1.5e-7)
        self.battery = max(0.0, self.battery)
        if self.battery <= 0 and self.state in ("RUNNING", "PAUSED", "RTL"):
            self._finish_mission("STOPPED")
            self.state = "ERROR"
            self._emit({"type": "log", "level": "ERROR", "message": "Battery depleted, vehicle halted"})

        # ---- phát packet ----
        rate = max(0.5, settings.telemetry_rate_hz)
        if self._t - self._last_tele_emit >= 1.0 / rate:
            self._last_tele_emit = self._t
            self._emit_telemetry()
        if self._t - self._last_sensor_emit >= 1.0:
            self._last_sensor_emit = self._t
            self._emit_sensor()
        if self.state in ("RUNNING", "PAUSED", "RTL") and self._t - self._last_mission_emit >= 0.5:
            self._emit_mission()
        if self._t - self._last_heartbeat >= 2.0:
            self._last_heartbeat = self._t
            self._emit({"type": "heartbeat"})

    def _emit_telemetry(self) -> None:
        self._emit({
            "type": "telemetry",
            "lat": round(self.lat, 7), "lon": round(self.lon, 7),
            "heading": round(self.heading, 1),
            "speed": round(self.speed_mps * 3.6, 2),      # km/h
            "battery": round(self.battery, 1),
            "voltage": round(10.5 + self.battery / 100 * 2.1, 2),
            "altitude": round(self.altitude, 1),
            "satellites": self.satellites,
            "armed": self.armed,
            "state": self.state,
            "current_waypoint": self.wp_index + 1 if self.state in ("RUNNING", "PAUSED") else 0,
            "total_waypoints": len(self.waypoints),
            "distance_travelled": round(self.distance_travelled, 1),
            "home_lat": self.home[0], "home_lon": self.home[1],
        })

    def _emit_sensor(self) -> None:
        t = self._t
        self._emit({
            "type": "sensor",
            "temperature": round(28.0 + 1.5 * math.sin(t / 60) + random.gauss(0, 0.05), 2),
            "humidity": round(70.0 + 4 * math.sin(t / 90 + 1) + random.gauss(0, 0.2), 1),
            "pressure": round(1012.0 + 1.2 * math.sin(t / 300) + random.gauss(0, 0.05), 2),
            "co2": round(640 + 60 * math.sin(t / 45) + random.gauss(0, 3), 0),
            "pm25": round(max(0, 18 + 5 * math.sin(t / 70) + random.gauss(0, 0.5)), 1),
            "pm10": round(max(0, 27 + 7 * math.sin(t / 70 + 0.4) + random.gauss(0, 0.6)), 1),
            "light": round(max(0, 820 + 150 * math.sin(t / 120) + random.gauss(0, 10)), 0),
            "gas": round(max(0, 120 + 15 * math.sin(t / 50) + random.gauss(0, 1)), 1),
            "imu_roll": round(2.0 * math.sin(t * 1.3) + random.gauss(0, 0.1), 2),
            "imu_pitch": round(1.5 * math.sin(t * 0.9 + 1) + random.gauss(0, 0.1), 2),
            "imu_yaw": round(self.heading, 1),
        })

    def _emit_mission(self, force: bool = False) -> None:
        self._last_mission_emit = self._t
        total = len(self.waypoints)
        remaining = 0.0
        if self.wp_index < total:
            wp = self.waypoints[self.wp_index]
            remaining = haversine_m(self.lat, self.lon, wp["lat"], wp["lon"])
            for i in range(self.wp_index, total - 1):
                a, b = self.waypoints[i], self.waypoints[i + 1]
                remaining += haversine_m(a["lat"], a["lon"], b["lat"], b["lon"])
        self._emit({
            "type": "mission",
            "state": self.mission_state,
            "current_waypoint": min(self.wp_index + 1, total) if total else 0,
            "completed": self.completed,
            "total": total,
            "distance_remaining": round(remaining, 1),
        })
