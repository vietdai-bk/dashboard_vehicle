from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..core.auth import CurrentUser
from ..hardware.camera import camera_streamer
from .common import fail, ok

router = APIRouter(prefix="/api/camera", tags=["camera"])


class DeviceSelectRequest(BaseModel):
    device: str | int


@router.get("/stream")
async def video_stream() -> StreamingResponse:
    """Trả về luồng video MJPEG từ webcam cắm trên Jetson / máy tính."""
    return StreamingResponse(
        camera_streamer.frame_generator(),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
        },
    )


@router.get("/snapshot")
def snapshot() -> Response:
    """Chụp ảnh tĩnh từ camera Jetson."""
    jpeg = camera_streamer.get_latest_jpeg()
    if not jpeg:
        return Response(content=b"", media_type="image/jpeg", status_code=503)
    return Response(content=jpeg, media_type="image/jpeg")


@router.get("/status")
def camera_status() -> dict[str, Any]:
    """Kiểm tra trạng thái camera trên Jetson."""
    return ok(camera_streamer.status())


@router.get("/devices")
def list_devices() -> dict[str, Any]:
    """Liệt kê danh sách các cổng camera (/dev/video*) đang cắm."""
    return ok(camera_streamer.list_video_devices())


@router.post("/device")
def set_device(body: DeviceSelectRequest, user: dict = CurrentUser) -> dict[str, Any]:
    """Đổi cổng camera đang phát."""
    camera_streamer.set_device(body.device)
    return ok(camera_streamer.status())
