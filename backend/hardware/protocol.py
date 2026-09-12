"""Giao thức UART giữa Raspberry Pi và STM32.

Mỗi packet là MỘT dòng JSON kết thúc bằng '\n'. Cả mock và UART đều đi qua
parse_packet() nên frontend/backend không phân biệt được nguồn.

STM32 -> Pi:
  {"type":"telemetry","lat":16.05,"lon":108.20,"heading":127.4,"speed":12.2,
   "battery":82,"armed":true,"state":"RUNNING","current_waypoint":2,"total_waypoints":5}
  {"type":"sensor","temperature":28.4,"humidity":71.2,"pressure":1012.3,"co2":640,...}
  {"type":"mission","state":"RUNNING","current_waypoint":2,"completed":1,"total":5,
   "distance_remaining":123.4,"progress":0.35}
  {"type":"ack","command":"ARM","ok":true,"message":"armed"}
  {"type":"log","level":"INFO","message":"..."}
  {"type":"heartbeat"}

Pi -> STM32:
  {"command":"ARM"}\n
  {"command":"UPLOAD_MISSION","waypoints":[{"id":1,"lat":..,"lon":..,"alt":..}]}\n
  {"command":"START"} / {"command":"STOP"} / {"command":"PAUSE"} / {"command":"RESUME"} / {"command":"RTL"}
"""
from __future__ import annotations

import json
import logging
from typing import Any, Optional

log = logging.getLogger("protocol")

PACKET_TYPES = {"telemetry", "sensor", "mission", "ack", "log", "heartbeat"}
COMMANDS = {"ARM", "DISARM", "UPLOAD_MISSION", "START", "STOP", "PAUSE", "RESUME", "RTL"}

# (khóa, kiểu, min, max) — kiểm tra giá trị hợp lệ cho packet telemetry/sensor
_TELEMETRY_RANGES: dict[str, tuple[float, float]] = {
    "lat": (-90, 90), "lon": (-180, 180), "heading": (0, 360), "speed": (0, 500),
    "battery": (0, 100), "altitude": (-500, 10000), "voltage": (0, 100), "satellites": (0, 64),
}
_SENSOR_RANGES: dict[str, tuple[float, float]] = {
    "temperature": (-60, 150), "humidity": (0, 100), "co2": (0, 50000),
    "co": (0, 10000), "pm25": (0, 5000), "tvoc": (0, 10000), 
    "nox": (0, 1000), "aqi": (0, 500)
}


class ProtocolError(ValueError):
    """Packet sai định dạng / ngoài dải cho phép."""


def _check_ranges(packet: dict[str, Any], ranges: dict[str, tuple[float, float]]) -> None:
    for key, (lo, hi) in ranges.items():
        if key in packet:
            value = packet[key]
            if not isinstance(value, (int, float)) or isinstance(value, bool):
                raise ProtocolError(f"{key} phải là số, nhận {value!r}")
            if not (lo <= value <= hi):
                raise ProtocolError(f"{key}={value} ngoài dải [{lo}, {hi}]")


def parse_packet(line: str | bytes) -> Optional[dict[str, Any]]:
    """Parse một dòng UART. Trả về dict đã validate, hoặc None nếu dòng trống.
    Raise ProtocolError khi packet không hợp lệ (caller log và bỏ qua, KHÔNG crash)."""
    if isinstance(line, bytes):
        line = line.decode("utf-8", errors="replace")
    line = line.strip()
    if not line:
        return None
    try:
        packet = json.loads(line)
    except json.JSONDecodeError as exc:
        raise ProtocolError(f"JSON không hợp lệ: {line[:80]!r}") from exc
    if not isinstance(packet, dict):
        raise ProtocolError("Packet phải là JSON object")
    ptype = packet.get("type")
    if ptype not in PACKET_TYPES:
        raise ProtocolError(f"type không hỗ trợ: {ptype!r}")
    if ptype == "telemetry":
        _check_ranges(packet, _TELEMETRY_RANGES)
    elif ptype == "sensor":
        _check_ranges(packet, _SENSOR_RANGES)
    elif ptype == "ack":
        if "command" not in packet or "ok" not in packet:
            raise ProtocolError("ack thiếu command/ok")
    elif ptype == "mission":
        for key in ("current_waypoint", "total"):
            if key in packet and not isinstance(packet[key], int):
                raise ProtocolError(f"mission.{key} phải là int")
    return packet


def encode_command(command: str, params: Optional[dict[str, Any]] = None) -> bytes:
    """Đóng gói lệnh gửi xuống STM32 (một dòng JSON + newline)."""
    if command not in COMMANDS:
        raise ProtocolError(f"Lệnh không hỗ trợ: {command}")
    payload: dict[str, Any] = {"command": command}
    if params:
        payload.update(params)
    return (json.dumps(payload, separators=(",", ":")) + "\n").encode("utf-8")


def waypoints_to_wire(waypoints: list[Any]) -> list[dict[str, Any]]:
    """Rút gọn waypoint về dạng STM32 dễ đọc (id, lat, lon, alt)."""
    return [{"id": wp.id, "lat": round(wp.latitude, 7), "lon": round(wp.longitude, 7),
             "alt": round(wp.altitude, 1)} for wp in waypoints]
