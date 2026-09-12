"""Data model dùng chung giữa backend và frontend (đồng bộ với frontend/src/types.ts)."""
from __future__ import annotations

import time
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field

VehicleStatus = Literal["DISARMED", "ARMED", "RUNNING", "PAUSED", "STOPPED", "RTL", "ERROR"]
MissionStatus = Literal["EMPTY", "READY", "UPLOADING", "UPLOADED", "RUNNING", "PAUSED",
                        "COMPLETED", "STOPPED", "ERROR"]
AlertLevel = Literal["info", "warning", "critical"]


class ApiResponse(BaseModel):
    ok: bool = True
    data: Any = None
    error: Optional[Dict[str, str]] = None


class Waypoint(BaseModel):
    id: int
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    order: int = 0
    altitude: float = 0.0
    name: str = ""


class WaypointCreate(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    altitude: Optional[float] = None
    name: str = ""


class WaypointUpdate(BaseModel):
    latitude: Optional[float] = Field(default=None, ge=-90, le=90)
    longitude: Optional[float] = Field(default=None, ge=-180, le=180)
    altitude: Optional[float] = None
    name: Optional[str] = None


class VehicleState(BaseModel):
    connected: bool = False
    source: str = "mock"                     # mock | uart
    armed: bool = False
    state: VehicleStatus = "DISARMED"
    latitude: float = 0.0
    longitude: float = 0.0
    altitude: float = 0.0
    heading: float = 0.0
    speed: float = 0.0                       # km/h
    battery: float = 0.0                     # %
    voltage: float = 0.0
    satellites: int = 0
    current_waypoint: int = 0                # 1-based, 0 = chưa có
    total_waypoints: int = 0
    distance_travelled_m: float = 0.0
    home_latitude: float = 0.0
    home_longitude: float = 0.0
    last_update: float = 0.0
    error_message: str = ""


class Telemetry(BaseModel):
    timestamp: float = Field(default_factory=time.time)
    temperature: float = 0.0
    humidity: float = 0.0
    co2: float = 0.0
    co: float = 0.0
    pm25: float = 0.0
    tvoc: float = 0.0
    nox: float = 0.0
    aqi: float = 0.0


class Mission(BaseModel):
    id: str = ""
    name: str = "Untitled mission"
    waypoints: List[Waypoint] = []
    status: MissionStatus = "EMPTY"
    uploaded: bool = False
    current_waypoint: int = 0
    completed: int = 0
    progress: float = 0.0                    # 0..1
    distance_total_m: float = 0.0
    distance_remaining_m: float = 0.0
    started_at: Optional[float] = None
    ended_at: Optional[float] = None
    upload_message: str = ""


class SavedMission(BaseModel):
    id: str
    name: str
    waypoints: List[Waypoint]
    created_at: float
    updated_at: float


class MissionHistoryEntry(BaseModel):
    id: str
    mission_id: str
    name: str
    status: MissionStatus
    started_at: float
    ended_at: float
    duration_s: float
    waypoints_total: int
    waypoints_completed: int
    distance_m: float
    battery_start: float
    battery_end: float
    track: List[List[float]] = []           # [[lat, lon], ...] đã giảm mẫu


class EventEntry(BaseModel):
    id: int
    timestamp: float
    level: str                                # INFO | WARNING | ERROR
    category: str                             # vehicle | mission | uart | system | alert
    message: str


class Alert(BaseModel):
    id: int
    key: str                                  # dùng để không lặp cảnh báo
    level: AlertLevel
    message: str
    timestamp: float
    active: bool = True
    acknowledged: bool = False


class ConnectionInfo(BaseModel):
    source: str
    connected: bool
    label: str                                # "MOCK ● ACTIVE" / "STM32 ● CONNECTED" ...
    detail: str = ""


class LoginRequest(BaseModel):
    username: str
    password: str


class CommandRequest(BaseModel):
    command: str
    params: Dict[str, Any] = {}
