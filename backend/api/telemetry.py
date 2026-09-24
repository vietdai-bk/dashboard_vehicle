from __future__ import annotations

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


# ---- CAN Bus diagnostics -------------------------------------------------------------
from pydantic import BaseModel


class CANInjectRequest(BaseModel):
    can_id: Optional[int] = None
    hex_data: Optional[str] = None
    temperature: Optional[float] = None
    humidity: Optional[float] = None
    tvoc: Optional[int] = None
    eco2: Optional[int] = None
    co: Optional[float] = None
    no2: Optional[float] = None
    pm25: Optional[float] = None
    aqi: Optional[int] = None


@router.get("/telemetry/can/status")
def can_status() -> dict:
    """Xem trạng thái kênh CAN bus (SocketCAN) và thông số cảm biến hiện tại."""
    from ..config import settings
    from ..hardware.can import CANReceiver

    return ok({
        "enabled": settings.can_enabled,
        "channel": settings.can_channel,
        "bitrate": settings.can_bitrate,
        "current_telemetry": store.telemetry.model_dump(),
    })


@router.post("/telemetry/can/inject")
def inject_can_frame(body: CANInjectRequest) -> dict:
    """Mô phỏng/test gửi dữ liệu CAN frame 0x555/0x556 vào xe."""
    import struct
    from ..hardware.protocol import decode_can_frame

    packet = None
    if body.can_id and body.hex_data:
        data = bytes.fromhex(body.hex_data.replace(" ", ""))
        packet = decode_can_frame(body.can_id, data)
    else:
        # Tự đóng gói thành 2 frame CAN theo đúng chuẩn C/C++ trên xe
        t = body.temperature if body.temperature is not None else 28.5
        h = body.humidity if body.humidity is not None else 65.0
        tv = body.tvoc if body.tvoc is not None else 120
        c2 = body.eco2 if body.eco2 is not None else 450
        co = body.co if body.co is not None else 1.2
        no = body.no2 if body.no2 is not None else 6.5
        pm = body.pm25 if body.pm25 is not None else 15.0
        aq = body.aqi if body.aqi is not None else 35

        f1 = struct.pack(">hHHH", int(round(t * 100)), int(round(h * 100)), int(tv), int(c2))
        f2 = struct.pack(">HHHBx", int(round(co * 10)), int(round(no * 10)), int(round(pm * 100)), int(aq))
        decode_can_frame(0x555, f1)
        packet = decode_can_frame(0x556, f2)

    if packet:
        store.apply_packet(packet)
        return ok({"applied": True, "packet": packet})
    return ok({"applied": False, "message": "Frame received but waiting for pair frame"})

