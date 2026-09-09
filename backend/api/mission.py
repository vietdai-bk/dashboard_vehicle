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
    return ok(list(reversed(mgr().history)))


@router.delete("/history")
def clear_history(user: dict = CurrentUser) -> dict:
    mgr().clear_history()
    return ok([])
