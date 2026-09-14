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
from typing import Any, Optional, Union

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


def _normalize_keys(packet: dict[str, Any]) -> dict[str, Any]:
    norm = {}
    key_map = {
        "latitude": "lat", "LAT": "lat", "Lat": "lat",
        "longitude": "lon", "lng": "lon", "LON": "lon", "Lon": "lon", "Lng": "lon",
        "speed": "speed", "spd": "speed", "SPEED": "speed", "Spd": "speed",
        "heading": "heading", "hdg": "heading", "HEADING": "heading", "Hdg": "heading",
        "battery": "battery", "bat": "battery", "BAT": "battery", "Bat": "battery",
        "altitude": "altitude", "alt": "altitude", "ALT": "altitude",
        "satellites": "satellites", "sat": "satellites", "SATS": "satellites",
        "temperature": "temperature", "temp": "temperature", "TEMP": "temperature",
        "humidity": "humidity", "hum": "humidity", "HUM": "humidity",
        "aqi": "aqi", "AQI": "aqi",
        "pm25": "pm25", "PM25": "pm25", "PM2.5": "pm25",
        "co2": "co2", "CO2": "co2",
        "co": "co", "CO": "co",
        "tvoc": "tvoc", "TVOC": "tvoc",
        "nox": "nox", "NOX": "nox",
        "state": "state", "STATE": "state",
        "armed": "armed", "ARMED": "armed",
    }
    for k, v in packet.items():
        dst = key_map.get(k, k.lower() if isinstance(k, str) else k)
        norm[dst] = v
    return norm


def _parse_key_value(line: str) -> Optional[dict[str, Any]]:
    """Parse chuỗi dạng LAT=16.05,LON=108.20,SPD=12 hoặc LAT:16.05 LON:108.20."""
    import re
    pairs = re.findall(r'([A-Za-z0-9_.]+)\s*[:=]\s*([^\s,;]+)', line)
    if not pairs:
        return None
    d: dict[str, Any] = {}
    for k, v in pairs:
        try:
            if "." in v:
                d[k] = float(v)
            else:
                d[k] = int(v)
        except ValueError:
            v_lower = v.lower()
            if v_lower in ("true", "yes", "on"):
                d[k] = True
            elif v_lower in ("false", "no", "off"):
                d[k] = False
            else:
                d[k] = v
    return d


def _parse_nmea(line: str) -> Optional[dict[str, Any]]:
    parts = line.split(",")
    header = parts[0].strip()
    if header in ("$GPRMC", "$GNRMC") and len(parts) >= 9:
        if parts[2] == "A":  # GPS fix OK
            def to_deg(raw: str, hemi: str) -> float:
                if not raw or "." not in raw:
                    return 0.0
                dot = raw.find(".")
                deg = float(raw[:dot-2]) if dot >= 2 else 0.0
                mins = float(raw[dot-2:]) if dot >= 2 else float(raw)
                val = deg + mins / 60.0
                return -val if hemi in ("S", "W") else val
            lat = to_deg(parts[3], parts[4])
            lon = to_deg(parts[5], parts[6])
            spd_knots = float(parts[7]) if parts[7] else 0.0
            hdg = float(parts[8]) if parts[8] else 0.0
            return {"type": "telemetry", "lat": lat, "lon": lon, "speed": round(spd_knots * 1.852, 1), "heading": hdg, "state": "RUNNING"}
    elif header in ("$GPGGA", "$GNGGA") and len(parts) >= 10:
        if parts[6] in ("1", "2"):
            def to_deg(raw: str, hemi: str) -> float:
                if not raw or "." not in raw:
                    return 0.0
                dot = raw.find(".")
                deg = float(raw[:dot-2]) if dot >= 2 else 0.0
                mins = float(raw[dot-2:]) if dot >= 2 else float(raw)
                val = deg + mins / 60.0
                return -val if hemi in ("S", "W") else val
            lat = to_deg(parts[2], parts[3])
            lon = to_deg(parts[4], parts[5])
            alt = float(parts[9]) if parts[9] else 0.0
            sats = int(parts[7]) if parts[7] else 0
            return {"type": "telemetry", "lat": lat, "lon": lon, "altitude": alt, "satellites": sats, "state": "RUNNING"}
    return None


def parse_packet(line: Union[str, bytes]) -> Optional[dict[str, Any]]:
    """Parse một dòng UART. Trả về dict đã validate, hoặc None nếu dòng trống.
    Hỗ trợ JSON chuẩn, JSON không có type, chuỗi key=value, và NMEA GPS.
    Raise ProtocolError khi packet không hợp lệ (caller log và bỏ qua, KHÔNG crash)."""
    if isinstance(line, bytes):
        line = line.decode("utf-8", errors="replace")
    line = line.strip()
    if not line:
        return None

    # 1. Thử parse NMEA nếu là câu GPS
    if line.startswith("$"):
        nmea = _parse_nmea(line)
        if nmea:
            return nmea

    # 2. Thử parse JSON (tìm cặp { và } để tránh nhiễu byte đầu/cuối đường truyền UART)
    packet: Optional[dict[str, Any]] = None
    start_brace = line.find("{")
    end_brace = line.rfind("}")
    if start_brace != -1 and end_brace > start_brace:
        json_str = line[start_brace:end_brace + 1]
        try:
            raw_obj = json.loads(json_str)
            if isinstance(raw_obj, dict):
                packet = _normalize_keys(raw_obj)
        except json.JSONDecodeError:
            pass

    # 3. Fallback: thử parse dạng key=value hoặc key:value
    if packet is None:
        kv = _parse_key_value(line)
        if kv and len(kv) >= 2:
            packet = _normalize_keys(kv)

    if packet is None:
        raise ProtocolError(f"Dữ liệu không nhận diện được: {line[:80]!r}")

    # 4. Tự suy diễn type nếu thiếu
    ptype = packet.get("type")
    if not ptype:
        if "lat" in packet or "lon" in packet or "speed" in packet or "heading" in packet:
            ptype = "telemetry"
        elif any(k in packet for k in ("temperature", "humidity", "co2", "aqi", "pm25", "tvoc", "nox")):
            ptype = "sensor"
        elif "command" in packet:
            ptype = "ack"
        elif "current_waypoint" in packet:
            ptype = "mission"
        else:
            ptype = "telemetry"
        packet["type"] = ptype

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
                try:
                    packet[key] = int(packet[key])
                except (ValueError, TypeError):
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
