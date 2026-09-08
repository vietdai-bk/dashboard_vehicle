from typing import Optional

from fastapi import APIRouter, Query

from ..core.auth import CurrentUser
from ..core.state import store
from .common import fail, ok

router = APIRouter(prefix="/api", tags=["telemetry"])


@router.get("/telemetry")
def telemetry() -> dict:
    return ok(store.telemetry)


@router.get("/telemetry/history")
def telemetry_history(seconds: int = Query(default=300, ge=10, le=3600 * 6)) -> dict:
    cutoff = store.telemetry.timestamp - seconds
    return ok([t for t in store.telemetry_history if t.timestamp >= cutoff])


@router.get("/track")
def track() -> dict:
    return ok(list(store.track))


@router.delete("/track")
def clear_track(user: dict = CurrentUser) -> dict:
    store.reset_track()
    return ok([])


@router.get("/events")
def events(limit: int = Query(default=200, ge=1, le=1000), category: Optional[str] = None) -> dict:
    return ok(store.events.list(limit, category))


@router.delete("/events")
def clear_events(user: dict = CurrentUser) -> dict:
    store.events.clear()
    return ok([])


@router.get("/alerts")
def alerts(active: bool = False) -> dict:
    return ok(store.alerts.list(active_only=active))


@router.post("/alerts/{alert_id}/ack")
def ack_alert(alert_id: int, user: dict = CurrentUser) -> dict:
    alert = store.alerts.acknowledge(alert_id)
    if alert is None:
        raise fail("ALERT_NOT_FOUND", f"Alert {alert_id} not found", 404)
    return ok(alert)
