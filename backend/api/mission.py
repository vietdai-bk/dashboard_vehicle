from __future__ import annotations
 
from typing import List, Optional

from fastapi import APIRouter
from pydantic import BaseModel

from ..core.auth import CurrentUser
from ..core.state import store
from ..mission.manager import MissionError
from ..models import WaypointCreate, WaypointUpdate
from .common import fail, ok

router = APIRouter(prefix="/api/mission", tags=["mission"])


def mgr():
    if store.mission is None:
        raise fail("NOT_READY", "Mission manager not initialised", 500)
    return store.mission


def _guard(exc: MissionError):
    status = 409 if exc.code in ("MISSION_ACTIVE", "NOT_ARMED", "NOT_UPLOADED", "NOT_CONNECTED",
                                 "INVALID_STATE", "UPLOAD_FAILED", "START_FAILED") else 400
    if exc.code.endswith("NOT_FOUND"):
        status = 404
    return fail(exc.code, exc.message, status)


class ReorderRequest(BaseModel):
    ids: List[int]


class NameRequest(BaseModel):
    name: str


@router.get("")
def get_mission() -> dict:
    return ok(mgr().current)


@router.delete("")
def clear_mission(user: dict = CurrentUser) -> dict:
    try:
        mgr().clear()
    except MissionError as exc:
        raise _guard(exc)
    return ok(mgr().current)


@router.post("/new")
def new_mission(user: dict = CurrentUser) -> dict:
    try:
        return ok(mgr().new_mission())
    except MissionError as exc:
        raise _guard(exc)


@router.put("/name")
def rename(body: NameRequest, user: dict = CurrentUser) -> dict:
    mgr().rename(body.name)
    return ok(mgr().current)


# ---- waypoints -----------------------------------------------------------------
@router.post("/waypoints")
def add_waypoint(body: WaypointCreate, user: dict = CurrentUser) -> dict:
    try:
        wp = mgr().add_waypoint(body)
    except MissionError as exc:
        raise _guard(exc)
    return ok({"waypoint": wp.model_dump(), "mission": mgr().current.model_dump()})


@router.put("/waypoints/reorder")
def reorder(body: ReorderRequest, user: dict = CurrentUser) -> dict:
    try:
        mgr().reorder(body.ids)
    except MissionError as exc:
        raise _guard(exc)
    return ok(mgr().current)


@router.put("/waypoints/{wp_id}")
def update_waypoint(wp_id: int, body: WaypointUpdate, user: dict = CurrentUser) -> dict:
    try:
        wp = mgr().update_waypoint(wp_id, body)
    except MissionError as exc:
        raise _guard(exc)
    return ok({"waypoint": wp.model_dump(), "mission": mgr().current.model_dump()})


@router.delete("/waypoints/{wp_id}")
def delete_waypoint(wp_id: int, user: dict = CurrentUser) -> dict:
    try:
        mgr().delete_waypoint(wp_id)
    except MissionError as exc:
        raise _guard(exc)
    return ok(mgr().current)


# ---- vehicle mission commands ----------------------------------------------------
@router.post("/upload")
async def upload(user: dict = CurrentUser) -> dict:
    try:
        return ok(await mgr().upload())
    except MissionError as exc:
        raise _guard(exc)


@router.post("/start")
async def start(user: dict = CurrentUser) -> dict:
    try:
        return ok(await mgr().start())
    except MissionError as exc:
        raise _guard(exc)


@router.post("/stop")
async def stop(user: dict = CurrentUser) -> dict:
    try:
        return ok(await mgr().stop())
    except MissionError as exc:
        raise _guard(exc)


@router.post("/pause")
async def pause(user: dict = CurrentUser) -> dict:
    try:
        return ok(await mgr().pause())
    except MissionError as exc:
        raise _guard(exc)


@router.post("/resume")
async def resume(user: dict = CurrentUser) -> dict:
    try:
        return ok(await mgr().resume())
    except MissionError as exc:
        raise _guard(exc)


@router.post("/abort")
async def abort(user: dict = CurrentUser) -> dict:
    try:
        return ok(await mgr().abort())
    except MissionError as exc:
        raise _guard(exc)


# ---- saved missions & history -----------------------------------------------------
@router.get("/saved")
def list_saved() -> dict:
    return ok(sorted(mgr().saved.values(), key=lambda m: m.updated_at, reverse=True))


@router.post("/saved")
def save(body: Optional[NameRequest] = None, user: dict = CurrentUser) -> dict:
    try:
        return ok(mgr().save(body.name if body else None))
    except MissionError as exc:
        raise _guard(exc)


@router.post("/saved/{mission_id}/load")
def load(mission_id: str, user: dict = CurrentUser) -> dict:
    try:
        return ok(mgr().load(mission_id))
    except MissionError as exc:
        raise _guard(exc)


@router.delete("/saved/{mission_id}")
def delete_saved(mission_id: str, user: dict = CurrentUser) -> dict:
    try:
        mgr().delete_saved(mission_id)
    except MissionError as exc:
        raise _guard(exc)
    return ok({"deleted": mission_id})


@router.get("/history")
def history() -> dict:
    mgr().reload_history()
    return ok(list(reversed(mgr().history)))


@router.delete("/history")
def clear_history(user: dict = CurrentUser) -> dict:
    mgr().clear_history()
    return ok([])


class RouteRequest(BaseModel):
    vehicle_lat: Optional[float] = None
    vehicle_lon: Optional[float] = None
    waypoints: Optional[List[List[float]]] = None


@router.post("/route")
def calculate_route(body: RouteRequest = RouteRequest()) -> dict:
    from ..mission.routing import calculate_street_route
    m = mgr().current
    v = store.vehicle
    v_lat = body.vehicle_lat if (body.vehicle_lat is not None and body.vehicle_lat != 0) else (v.latitude if v.latitude != 0 else (v.home_latitude if v.home_latitude != 0 else settings.home_lat))
    v_lon = body.vehicle_lon if (body.vehicle_lon is not None and body.vehicle_lon != 0) else (v.longitude if v.longitude != 0 else (v.home_longitude if v.home_longitude != 0 else settings.home_lon))
    start = (v_lat, v_lon)

    if body.waypoints is not None:
        wps = [(p[0], p[1]) for p in body.waypoints]
    else:
        user_wps = m.user_waypoints if m.user_waypoints else [
            w for w in m.waypoints if not w.is_turn and w.name != "Xuất phát"
        ]
        wps = [(w.latitude, w.longitude) for w in user_wps]

    targets = m.user_waypoints if m.user_waypoints else [
        w for w in m.waypoints if not w.is_turn and w.name != "Xuất phát"
    ]

    res = calculate_street_route(start, wps, target_waypoints=targets)
    mgr().set_route_points(res["route"])
    # Tự động thay thế toàn bộ waypoints thành các điểm cua và đích nằm 100% trên đường đã vạch để xe rẽ
    turn_pts = res.get("turn_points", [])
    if turn_pts and len(turn_pts) >= 1:
        try:
            mgr().apply_turn_waypoints(turn_pts)
        except Exception as exc:
            log.exception("Failed to apply turn waypoints: %s", exc)
    return ok({
        "route": res["route"],
        "turn_points": res.get("turn_points", []),
        "distance_m": res["distance_m"],
        "duration_s": res["duration_s"],
        "is_street": res["is_street"],
        "mission": mgr().current.model_dump(),
    })


@router.delete("/route")
def clear_route(user: dict = CurrentUser) -> dict:
    return ok(mgr().clear_route())


@router.post("/apply-turns")
def apply_turns(user: dict = CurrentUser) -> dict:
    try:
        return ok(mgr().apply_turn_waypoints())
    except MissionError as exc:
        raise _guard(exc)


@router.get("/waypoints/{wp_id}/csv")
def download_waypoint_csv(wp_id: int):
    """Tải file CSV dữ liệu lấy mẫu tại waypoint."""
    import time
    from fastapi.responses import FileResponse
    from ..mission.manager import WP_DATA_DIR, save_waypoint_csv

    wp = None
    m = mgr().current
    for w in m.waypoints:
        if w.id == wp_id:
            wp = w
            break
    if not wp and m.user_waypoints:
        for w in m.user_waypoints:
            if w.id == wp_id:
                wp = w
                break
    if not wp:
        for h in mgr().history:
            for w in h.waypoints:
                if w.id == wp_id:
                    wp = w
                    break
            if wp:
                break
    if not wp:
        raise fail("NOT_FOUND", f"Không tìm thấy waypoint ID {wp_id}", 404)

    # 1. Nếu file đã tồn tại trên đĩa
    if wp.csv_file:
        file_path = WP_DATA_DIR / wp.csv_file
        if file_path.exists():
            return FileResponse(
                path=str(file_path),
                filename=wp.csv_file,
                media_type="text/csv",
                headers={"Content-Disposition": f'attachment; filename="{wp.csv_file}"'}
            )

    # 2. Nếu chưa có file nhưng đã có dữ liệu đo đạc (telemetry), sinh file CSV và gửi về
    if wp.telemetry:
        sample_count = wp.sample_count or int(wp.telemetry.get("sample_count", 60)) or 60
        base = wp.telemetry
        samples = []
        now = wp.reached_at or time.time()
        for i in range(sample_count):
            t_s = now - (sample_count - 1 - i)
            samples.append({
                "timestamp": t_s,
                "lat": wp.latitude,
                "lon": wp.longitude,
                "alt": wp.altitude,
                "pm25": base.get("pm25", 0.0),
                "pm10": base.get("pm10", round(float(base.get("pm25", 0.0)) * 1.5, 1)),
                "co": base.get("co", 0.0),
                "nox": base.get("nox", 0.0),
                "co2": base.get("co2", 0.0),
                "tvoc": base.get("tvoc", 0.0),
                "temperature": base.get("temperature", 0.0),
                "humidity": base.get("humidity", 0.0),
                "aqi": base.get("aqi", 0),
            })
        filename, fpath, avg_tele = save_waypoint_csv(wp.id, wp.name, wp.latitude, wp.longitude, wp.altitude, samples)
        wp.csv_file = filename
        wp.sample_count = len(samples)
        wp.telemetry = avg_tele
        return FileResponse(
            path=str(fpath),
            filename=filename,
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'}
        )

    raise fail("NO_DATA", f"Waypoint {wp.name} chưa có dữ liệu đo đạc (chưa hoàn thành lấy mẫu)", 400)

