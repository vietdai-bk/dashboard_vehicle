import socket
import time
from typing import Any

from fastapi import APIRouter

from ..config import VERSION, settings
from ..core.auth import CurrentUser
from ..core.state import store
from ..core.websocket import manager as ws_manager
from .common import fail, ok

router = APIRouter(prefix="/api/config", tags=["config"])


def _local_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return "127.0.0.1"


@router.get("")
def get_config() -> dict:
    return ok({"settings": settings.public_dict(), "editable": settings.editable_keys()})


@router.put("")
def update_config(patch: dict[str, Any], user: dict = CurrentUser) -> dict:
    try:
        changed = settings.update(patch)
    except ValueError as exc:
        raise fail("INVALID_SETTING", str(exc))
    settings.save()
    if changed:
        store.events.add("INFO", "system", "Settings updated: " + ", ".join(changed))
    ws_manager.broadcast_nowait({"type": "settings", "data": settings.public_dict()})
    return ok({"settings": settings.public_dict(), "changed": changed})


@router.get("/system")
def system_info() -> dict:
    return ok({
        "server_ip": _local_ip(),
        "server_port": settings.server_port,
        "version": VERSION,
        "uptime_s": round(time.time() - store.started_at, 1),
        "ws_clients": ws_manager.count,
        "data_source": settings.data_source,
        "python": __import__("sys").version.split()[0],
    })
