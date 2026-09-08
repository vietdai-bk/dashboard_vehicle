from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from ..config import settings
from ..core.auth import CurrentUser
from ..core.state import store
from ..hardware.protocol import COMMANDS
from ..models import CommandRequest
from ..telemetry.provider import TelemetryProvider
from .common import fail, ok

router = APIRouter(prefix="/api/vehicle", tags=["vehicle"])


class ConnectRequest(BaseModel):
    source: Optional[str] = None      # mock | uart
    port: Optional[str] = None
    baudrate: Optional[int] = None


def build_provider(source: str, port: Optional[str] = None, baudrate: Optional[int] = None) -> TelemetryProvider:
    """Factory: chọn provider theo config. Frontend không biết provider nào đang chạy."""
    if source == "mock":
        from ..telemetry.mock import MockTelemetryProvider
        return MockTelemetryProvider()
    if source == "uart":
        from ..hardware.uart import UARTTelemetryProvider
        return UARTTelemetryProvider(port, baudrate)
    raise ValueError(f"Unknown DATA_SOURCE '{source}' (expected mock|uart)")


@router.get("/state")
def vehicle_state() -> dict:
    return ok(store.vehicle)


@router.get("/connection")
def connection() -> dict:
    return ok(store.connection_info())


@router.post("/connect")
async def connect(body: ConnectRequest, user: dict = CurrentUser) -> dict:
    source = body.source or settings.data_source
    if body.port:
        settings.uart_port = body.port
    if body.baudrate:
        settings.uart_baudrate = body.baudrate
    try:
        provider = build_provider(source, settings.uart_port, settings.uart_baudrate)
        await store.set_provider(provider)
    except Exception as exc:  # noqa: BLE001
        raise fail("CONNECT_FAILED", str(exc), 500)
    settings.data_source = source
    settings.save()
    return ok(store.connection_info())


@router.post("/disconnect")
async def disconnect(user: dict = CurrentUser) -> dict:
    await store.stop_provider()
    return ok(store.connection_info())


async def _command(command: str, params: Optional[dict] = None) -> dict:
    if store.provider is None or not store.vehicle.connected:
        raise fail("NOT_CONNECTED", "Vehicle is not connected", 409)
    result = await store.provider.send_command(command, params)
    if not result.ok:
        store.events.add("WARNING", "vehicle", f"{command} rejected: {result.message}")
        raise fail(f"{command}_REJECTED", result.message, 409)
    store.events.add("INFO", "vehicle", f"{command}: {result.message}")
    store.apply_ack(command)
    return ok({"command": command, **result.to_dict()})


@router.post("/arm")
async def arm(user: dict = CurrentUser) -> dict:
    if store.vehicle.state in ("RUNNING", "PAUSED"):
        raise fail("INVALID_STATE", "Cannot ARM while mission is active", 409)
    return await _command("ARM")


@router.post("/disarm")
async def disarm(user: dict = CurrentUser) -> dict:
    if store.vehicle.state in ("RUNNING", "PAUSED") and store.mission is not None:
        # xử lý an toàn: dừng mission trước
        await store.mission.stop()
    return await _command("DISARM")


@router.post("/rtl")
async def rtl(user: dict = CurrentUser) -> dict:
    if not store.vehicle.armed:
        raise fail("NOT_ARMED", "Vehicle must be armed", 409)
    if store.mission is not None and store.mission.current.status in ("RUNNING", "PAUSED"):
        await store.mission.stop()
    return await _command("RTL")


@router.post("/command")
async def raw_command(body: CommandRequest, user: dict = CurrentUser) -> dict:
    """Lệnh tổng quát (dùng cho debug / mở rộng). Chỉ chấp nhận lệnh trong protocol."""
    if body.command not in COMMANDS:
        raise fail("UNKNOWN_COMMAND", f"Unsupported command {body.command}")
    return await _command(body.command, body.params)
