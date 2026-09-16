from __future__ import annotations

from typing import Any, Optional, Union

from fastapi import APIRouter, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..core.auth import CurrentUser
from ..hardware.camera import camera_streamer
from .common import fail, ok

router = APIRouter(prefix="/api/camera", tags=["camera"])


class DeviceSelectRequest(BaseModel):
    device: Union[str, int]


@router.get("/stream")
async def video_stream(request: Request) -> StreamingResponse:
    """Trả về luồng video MJPEG từ webcam cắm trên Jetson / máy tính."""
    return StreamingResponse(
        camera_streamer.frame_generator(request),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
        },
    )


@router.post("/start")
def start_camera() -> dict:
    """Kích hoạt camera trên Jetson khi vào tab Camera."""
    camera_streamer.start()
    return ok(camera_streamer.status())


@router.post("/stop")
def stop_camera() -> dict:
    """Tắt camera trên Jetson khi rời tab để tiết kiệm băng thông và giải phóng phần cứng."""
    camera_streamer.stop()
    return ok(camera_streamer.status())


@router.get("/snapshot")
def snapshot() -> Response:
    """Chụp ảnh tĩnh từ camera Jetson."""
    jpeg = camera_streamer.get_latest_jpeg()
    if not jpeg:
        return Response(content=b"", media_type="image/jpeg", status_code=503)
    return Response(content=jpeg, media_type="image/jpeg")


@router.get("/status")
def camera_status() -> dict:
    """Kiểm tra trạng thái camera trên Jetson."""
    return ok(camera_streamer.status())


@router.get("/devices")
def list_devices() -> dict:
    """Liệt kê danh sách các cổng camera (/dev/video*) đang cắm."""
    return ok(camera_streamer.list_video_devices())


@router.post("/device")
def set_device(body: DeviceSelectRequest, user: dict = CurrentUser) -> dict:
    """Đổi cổng camera đang phát."""
    camera_streamer.set_device(body.device)
    return ok(camera_streamer.status())
