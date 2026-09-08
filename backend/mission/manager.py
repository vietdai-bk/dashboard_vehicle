"""MissionManager — waypoint, mission state machine, lưu/tải mission, lịch sử."""
from __future__ import annotations

import json
import logging
import time
import uuid
from pathlib import Path
from typing import Any, Optional

from ..config import DATA_DIR, settings
from ..core.state import VehicleStateStore, haversine_m
from ..core.websocket import manager as ws_manager
from ..hardware.protocol import waypoints_to_wire
from ..models import (Mission, MissionHistoryEntry, SavedMission, Waypoint, WaypointCreate,
                      WaypointUpdate)

log = logging.getLogger("mission")


class MissionError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class MissionManager:
    def __init__(self, store: VehicleStateStore,
                 missions_file: Path = DATA_DIR / "missions.json",
                 history_file: Path = DATA_DIR / "history.json") -> None:
        self.store = store
        self.current = Mission(id=uuid.uuid4().hex[:8])
        self._next_wp_id = 1
        self._missions_file = missions_file
        self._history_file = history_file
        self.saved: dict[str, SavedMission] = self._load_json(missions_file, SavedMission)
        self.history: list[MissionHistoryEntry] = list(self._load_json(history_file, MissionHistoryEntry).values())
        self.history.sort(key=lambda h: h.started_at)
        self._battery_start = 0.0
        self._distance_start = 0.0
        store.mission = self

    # ------------------------------------------------------------------ persistence
    @staticmethod
    def _load_json(path: Path, model: Any) -> dict[str, Any]:
        if not path.exists():
            return {}
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            items = [model(**x) for x in raw]
            return {x.id: x for x in items}
        except Exception as exc:  # noqa: BLE001
            log.warning("Cannot read %s: %s", path, exc)
            return {}

    @staticmethod
    def _dump_json(path: Path, items: list[Any]) -> None:
        DATA_DIR.mkdir(exist_ok=True)
        path.write_text(json.dumps([x.model_dump() for x in items], indent=2, ensure_ascii=False), encoding="utf-8")

    # ------------------------------------------------------------------ helpers
    def _broadcast(self) -> None:
        ws_manager.broadcast_nowait({"type": "mission", "data": self.current.model_dump()})

    def _recompute(self) -> None:
        m = self.current
        m.waypoints.sort(key=lambda w: w.order)
        for i, wp in enumerate(m.waypoints, start=1):
            wp.order = i
            if not wp.name or wp.name.startswith("WP"):
                wp.name = f"WP{i:02d}"
        total = 0.0
        for a, b in zip(m.waypoints, m.waypoints[1:]):
            total += haversine_m(a.latitude, a.longitude, b.latitude, b.longitude)
        m.distance_total_m = round(total, 1)
        if m.status not in ("RUNNING", "PAUSED"):
            m.status = "EMPTY" if not m.waypoints else ("UPLOADED" if m.uploaded else "READY")

    def _invalidate_upload(self) -> None:
        if self.current.status in ("RUNNING", "PAUSED"):
            raise MissionError("MISSION_ACTIVE", "Cannot edit waypoints while mission is running")
        self.current.uploaded = False
        self.current.upload_message = ""
        self.current.progress = 0.0
        self.current.completed = 0
        self.current.current_waypoint = 0

    # ------------------------------------------------------------------ waypoints
    def add_waypoint(self, data: WaypointCreate) -> Waypoint:
        self._invalidate_upload()
        wp = Waypoint(id=self._next_wp_id, latitude=data.latitude, longitude=data.longitude,
                      order=len(self.current.waypoints) + 1,
                      altitude=data.altitude if data.altitude is not None else 0.0, name=data.name)
        self._next_wp_id += 1
        self.current.waypoints.append(wp)
        self._recompute()
        self.store.events.add("INFO", "mission", f"Waypoint {wp.name} added ({wp.latitude:.5f}, {wp.longitude:.5f})")
        self._broadcast()
        return wp

    def update_waypoint(self, wp_id: int, data: WaypointUpdate) -> Waypoint:
        wp = self._find(wp_id)
        self._invalidate_upload()
        for key, value in data.model_dump(exclude_none=True).items():
            setattr(wp, key, value)
        self._recompute()
        self._broadcast()
        return wp

    def delete_waypoint(self, wp_id: int) -> None:
        wp = self._find(wp_id)
        self._invalidate_upload()
        self.current.waypoints.remove(wp)
        self._recompute()
        self.store.events.add("INFO", "mission", f"Waypoint {wp.name} deleted")
        self._broadcast()

    def reorder(self, ids: list[int]) -> None:
        current_ids = {w.id for w in self.current.waypoints}
        if set(ids) != current_ids or len(ids) != len(current_ids):
            raise MissionError("INVALID_ORDER", "Order list must contain every waypoint id exactly once")
        self._invalidate_upload()
        for order, wp_id in enumerate(ids, start=1):
            self._find(wp_id).order = order
        self._recompute()
        self.store.events.add("INFO", "mission", "Waypoints reordered")
        self._broadcast()

    def clear(self) -> None:
        self._invalidate_upload()
        self.current.waypoints.clear()
        self._recompute()
        self.store.events.add("INFO", "mission", "Mission cleared")
        self._broadcast()

    def _find(self, wp_id: int) -> Waypoint:
        for wp in self.current.waypoints:
            if wp.id == wp_id:
                return wp
        raise MissionError("WAYPOINT_NOT_FOUND", f"Waypoint {wp_id} not found")

    def rename(self, name: str) -> None:
        self.current.name = name.strip() or "Untitled mission"
        self._broadcast()

    # ------------------------------------------------------------------ vehicle commands
    def _provider(self) -> Any:
        p = self.store.provider
        if p is None or not self.store.vehicle.connected:
            raise MissionError("NOT_CONNECTED", "Vehicle is not connected")
        return p

    async def upload(self) -> Mission:
        m = self.current
        if not m.waypoints:
            raise MissionError("EMPTY_MISSION", "Cannot upload an empty mission")
        if m.status in ("RUNNING", "PAUSED"):
            raise MissionError("MISSION_ACTIVE", "Mission already running")
        provider = self._provider()
        m.status = "UPLOADING"
        m.upload_message = "Uploading…"
        self._broadcast()
        result = await provider.send_command("UPLOAD_MISSION", {"waypoints": waypoints_to_wire(m.waypoints)})
        if result.ok:
            m.uploaded = True
            m.status = "UPLOADED"
            m.upload_message = result.message or "Uploaded"
            self.store.events.add("INFO", "mission", f"Mission uploaded ({len(m.waypoints)} waypoints)")
        else:
            m.uploaded = False
            m.status = "ERROR"
            m.upload_message = result.message or "Upload failed"
            self.store.events.add("ERROR", "mission", f"Mission upload failed: {m.upload_message}")
        self._broadcast()
        if not result.ok:
            raise MissionError("UPLOAD_FAILED", m.upload_message)
        return m

    async def start(self) -> Mission:
        m, v = self.current, self.store.vehicle
        if not m.waypoints:
            raise MissionError("EMPTY_MISSION", "Add at least one waypoint")
        if not v.armed:
            raise MissionError("NOT_ARMED", "Vehicle must be ARMED before START")
        if not m.uploaded:
            raise MissionError("NOT_UPLOADED", "Upload the mission before START")
        if m.status in ("RUNNING", "PAUSED"):
            raise MissionError("MISSION_ACTIVE", "Mission already running")
        result = await self._provider().send_command("START")
        if not result.ok:
            raise MissionError("START_FAILED", result.message)
        self.store.apply_ack("START")
        m.status = "RUNNING"
        m.started_at = time.time()
        m.ended_at = None
        m.completed = 0
        m.current_waypoint = 1
        m.progress = 0.0
        self._battery_start = v.battery
        self._distance_start = v.distance_travelled_m
        self.store.reset_track()
        self.store.events.add("INFO", "mission", f"Mission '{m.name}' started")
        self._broadcast()
        return m

    async def _simple(self, command: str, from_states: tuple[str, ...], new_status: str, label: str) -> Mission:
        m = self.current
        if m.status not in from_states:
            raise MissionError("INVALID_STATE", f"Cannot {label} when mission is {m.status}")
        result = await self._provider().send_command(command)
        if not result.ok:
            raise MissionError(f"{command}_FAILED", result.message)
        self.store.apply_ack(command)
        m.status = new_status  # type: ignore[assignment]
        self.store.events.add("INFO", "mission", f"Mission {label}")
        self._broadcast()
        return m

    async def stop(self) -> Mission:
        m = await self._simple("STOP", ("RUNNING", "PAUSED"), "STOPPED", "stopped")
        self._finalize("STOPPED")
        return m

    async def pause(self) -> Mission:
        return await self._simple("PAUSE", ("RUNNING",), "PAUSED", "paused")

    async def resume(self) -> Mission:
        return await self._simple("RESUME", ("PAUSED",), "RUNNING", "resumed")

    async def abort(self) -> Mission:
        """Abort = STOP ngay + (tuỳ chọn) RTL."""
        m = await self.stop()
        self.store.events.add("WARNING", "mission", "Mission aborted by operator")
        if settings.auto_rtl_on_abort and self.store.provider is not None:
            await self.store.provider.send_command("RTL")
        return m

    # ------------------------------------------------------------------ progress từ vehicle
    def on_progress(self, packet: dict[str, Any]) -> None:
        m = self.current
        state = packet.get("state")
        m.current_waypoint = int(packet.get("current_waypoint", m.current_waypoint))
        m.completed = int(packet.get("completed", m.completed))
        m.distance_remaining_m = float(packet.get("distance_remaining", m.distance_remaining_m))
        total = len(m.waypoints)
        if "progress" in packet:
            m.progress = float(packet["progress"])
        elif m.distance_total_m > 0:
            # tiến độ theo quãng đường còn lại, cộng thêm bám theo số WP đã qua
            by_distance = 1.0 - min(1.0, m.distance_remaining_m / max(m.distance_total_m, 1.0))
            m.progress = max(by_distance, m.completed / total if total else 0.0)
        elif total:
            m.progress = m.completed / total
        if state == "COMPLETED" and m.status in ("RUNNING", "PAUSED"):
            m.status = "COMPLETED"
            m.progress = 1.0
            self.store.events.add("INFO", "mission", f"Mission '{m.name}' completed ({m.completed}/{total} waypoints)")
            self._finalize("COMPLETED")
            self._vehicle_idle()
        elif state == "STOPPED" and m.status in ("RUNNING", "PAUSED"):
            m.status = "STOPPED"
            self.store.events.add("WARNING", "mission", "Vehicle stopped the mission")
            self._finalize("STOPPED")
            self._vehicle_idle()
        elif state in ("RUNNING", "PAUSED") and m.status in ("RUNNING", "PAUSED"):
            m.status = state  # type: ignore[assignment]
        self._broadcast()

    def _vehicle_idle(self) -> None:
        """Vehicle báo mission kết thúc => nó không còn RUNNING; cập nhật ngay, telemetry kế tiếp sẽ xác nhận."""
        v = self.store.vehicle
        if v.state in ("RUNNING", "PAUSED"):
            new_state = "ARMED" if v.armed else "DISARMED"
            self.store.events.add("INFO", "vehicle", f"Vehicle state {v.state} → {new_state}")
            v.state = new_state  # type: ignore[assignment]
            v.speed = 0.0
            self.store.broadcast_vehicle()

    def _finalize(self, status: str) -> None:
        m, v = self.current, self.store.vehicle
        if m.ended_at is not None or m.started_at is None:
            return
        m.ended_at = time.time()
        track = list(self.store.track)
        step = max(1, len(track) // 500)
        entry = MissionHistoryEntry(
            id=uuid.uuid4().hex[:8], mission_id=m.id, name=m.name, status=status,  # type: ignore[arg-type]
            started_at=m.started_at, ended_at=m.ended_at, duration_s=round(m.ended_at - m.started_at, 1),
            waypoints_total=len(m.waypoints), waypoints_completed=m.completed,
            distance_m=round(max(0.0, v.distance_travelled_m - self._distance_start), 1),
            battery_start=round(self._battery_start, 1), battery_end=round(v.battery, 1),
            track=track[::step])
        self.history.append(entry)
        self._dump_json(self._history_file, self.history[-200:])
        ws_manager.broadcast_nowait({"type": "history", "data": entry.model_dump()})
        self._broadcast()

    # ------------------------------------------------------------------ saved missions
    def save(self, name: Optional[str] = None) -> SavedMission:
        m = self.current
        if not m.waypoints:
            raise MissionError("EMPTY_MISSION", "Nothing to save")
        if name:
            m.name = name.strip() or m.name
        now = time.time()
        existing = self.saved.get(m.id)
        saved = SavedMission(id=m.id, name=m.name, waypoints=[w.model_copy() for w in m.waypoints],
                             created_at=existing.created_at if existing else now, updated_at=now)
        self.saved[saved.id] = saved
        self._dump_json(self._missions_file, list(self.saved.values()))
        self.store.events.add("INFO", "mission", f"Mission '{saved.name}' saved")
        self._broadcast()
        return saved

    def load(self, mission_id: str) -> Mission:
        saved = self.saved.get(mission_id)
        if saved is None:
            raise MissionError("MISSION_NOT_FOUND", f"Mission {mission_id} not found")
        if self.current.status in ("RUNNING", "PAUSED"):
            raise MissionError("MISSION_ACTIVE", "Stop the running mission first")
        self.current = Mission(id=saved.id, name=saved.name, waypoints=[w.model_copy() for w in saved.waypoints])
        self._next_wp_id = max((w.id for w in self.current.waypoints), default=0) + 1
        self._recompute()
        self.store.events.add("INFO", "mission", f"Mission '{saved.name}' loaded")
        self._broadcast()
        return self.current

    def new_mission(self) -> Mission:
        if self.current.status in ("RUNNING", "PAUSED"):
            raise MissionError("MISSION_ACTIVE", "Stop the running mission first")
        self.current = Mission(id=uuid.uuid4().hex[:8])
        self._next_wp_id = 1
        self._broadcast()
        return self.current

    def delete_saved(self, mission_id: str) -> None:
        if mission_id not in self.saved:
            raise MissionError("MISSION_NOT_FOUND", f"Mission {mission_id} not found")
        name = self.saved.pop(mission_id).name
        self._dump_json(self._missions_file, list(self.saved.values()))
        self.store.events.add("INFO", "mission", f"Saved mission '{name}' deleted")

    def clear_history(self) -> None:
        self.history.clear()
        self._dump_json(self._history_file, [])
