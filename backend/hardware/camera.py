"""Jetson / USB Camera Streamer — đọc camera cắm trên Jetson (/dev/video0) và phát MJPEG qua HTTP.

Tối ưu cho Jetson Nano / Orin / Raspberry Pi:
- cv2.CAP_V4L2 với CAP_PROP_BUFFERSIZE = 1 để không bị trễ hình (zero-latency).
- Chỉ mở camera khi có client xem trên web (on-demand), tự tắt khi không có ai xem để tiết kiệm tài nguyên Jetson.
- Nếu chưa cài OpenCV, tự sinh frame ảnh hướng dẫn (không làm crash server).
"""
from __future__ import annotations

import asyncio
import glob
import io
import logging
import os
import sys
import threading
import time
from typing import Any, AsyncGenerator, Optional

log = logging.getLogger("camera")

try:
    import cv2  # type: ignore
except ImportError:
    cv2 = None


def _generate_fallback_jpeg(message: str, subtext: str = "") -> bytes:
    """Tạo một frame JPEG đơn giản thông báo lỗi / hướng dẫn khi không mở được camera."""
    # Nếu có PIL (Pillow) hoặc cv2 thì dùng, nếu không có thì trả về BMP/JPEG tĩnh tối giản
    try:
        from PIL import Image, ImageDraw, ImageFont
        img = Image.new("RGB", (640, 360), color=(18, 24, 38))
        draw = ImageDraw.Draw(img)
        draw.rectangle([(20, 20), (620, 340)], outline=(40, 55, 80), width=2)
        draw.text((40, 140), message, fill=(239, 68, 68))
        if subtext:
            draw.text((40, 180), subtext, fill=(148, 163, 184))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=80)
        return buf.getvalue()
    except Exception:
        # Fallback ảnh JPEG tối giản
        return b""


class CameraStreamer:
    def __init__(self, device: int | str = 0, width: int = 640, height: int = 480, fps: int = 25) -> None:
        self.device = device
        self.width = width
        self.height = height
        self.fps = fps
        self.quality = 70

        self._lock = threading.Lock()
        self._condition = threading.Condition(self._lock)
        self._latest_jpeg: bytes = b""
        self._frame_id: int = 0
        self._last_frame_time: float = 0.0

        self._client_count: int = 0
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._active: bool = False
        self._error: str = ""

    # ------------------------------------------------------------------ devices
    @staticmethod
    def list_video_devices() -> list[dict[str, Any]]:
        """Liệt kê các cổng video có trên Jetson / Linux (/dev/video*)."""
        devices = []
        if sys.platform.startswith("linux"):
            for path in sorted(glob.glob("/dev/video*")):
                # Đọc tên thiết bị nếu có
                name = path
                name_file = f"/sys/class/video4linux/{os.path.basename(path)}/name"
                if os.path.exists(name_file):
                    try:
                        with open(name_file, encoding="utf-8") as f:
                            name = f.read().strip()
                    except Exception:
                        pass
                devices.append({"id": path, "name": name, "path": path})
        else:
            # Trên Windows / khác: thử index 0..2
            devices.append({"id": 0, "name": "Camera 0 (Default USB/Webcam)", "path": "0"})
            devices.append({"id": 1, "name": "Camera 1", "path": "1"})
        return devices

    def set_device(self, device: int | str) -> None:
        with self._lock:
            if self.device != device:
                self.device = device
                need_restart = self._active
        if need_restart:
            self.stop()
            self.start()

    # ------------------------------------------------------------------ capture thread
    def start(self) -> None:
        with self._lock:
            if self._active and self._thread and self._thread.is_alive():
                return
            self._stop_event.clear()
            self._active = True
            self._thread = threading.Thread(target=self._capture_loop, name="camera-capture", daemon=True)
            self._thread.start()
            log.info("Camera streamer thread started for device %s", self.device)

    def stop(self) -> None:
        self._stop_event.set()
        with self._lock:
            self._active = False
            self._condition.notify_all()
        if self._thread:
            self._thread.join(timeout=2.0)
            self._thread = None
        log.info("Camera streamer thread stopped")

    def _open_capture(self) -> Any:
        if cv2 is None:
            self._error = "OpenCV (cv2) chưa được cài đặt. Hãy chạy: pip install opencv-python-headless"
            log.error(self._error)
            return None

        dev = self.device
        # Chuyển chuỗi số thành int
        if isinstance(dev, str) and dev.isdigit():
            dev = int(dev)

        # Trên Linux (Jetson / Pi): dùng V4L2 backend
        backend = cv2.CAP_V4L2 if hasattr(cv2, "CAP_V4L2") and sys.platform.startswith("linux") else cv2.CAP_ANY
        try:
            cap = cv2.VideoCapture(dev, backend)
        except Exception as exc:
            cap = cv2.VideoCapture(dev)

        if not cap.isOpened():
            # Thử lại với index 0 nếu path string lỗi
            if isinstance(dev, str) and "/dev/video" in dev:
                try:
                    num = int(dev.replace("/dev/video", ""))
                    cap = cv2.VideoCapture(num)
                except Exception:
                    pass

        if not cap.isOpened():
            self._error = f"Không thể mở camera thiết bị: {self.device}. Kiểm tra cáp USB hoặc quyền /dev/video*."
            log.warning(self._error)
            return None

        # Tối ưu hóa độ trễ cực thấp (zero latency) cho Jetson
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.width)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.height)
        cap.set(cv2.CAP_PROP_FPS, self.fps)
        self._error = ""
        log.info("Camera device %s opened successfully (%dx%d)", self.device, self.width, self.height)
        return cap

    def _capture_loop(self) -> None:
        cap = None
        reconnect_delay = 1.0

        encode_param = [int(cv2.IMWRITE_JPEG_QUALITY), self.quality] if cv2 is not None else []

        while not self._stop_event.is_set():
            if cap is None or not cap.isOpened():
                cap = self._open_capture()
                if cap is None or not cap.isOpened():
                    # Tạo frame thông báo lỗi tạm thời
                    err_msg = self._error or f"Không tìm thấy camera {self.device}"
                    placeholder = _generate_fallback_jpeg(err_msg, "Cắm lại webcam USB vào Jetson")
                    with self._condition:
                        self._latest_jpeg = placeholder
                        self._frame_id += 1
                        self._condition.notify_all()
                    self._stop_event.wait(reconnect_delay)
                    continue

            success, frame = cap.read()
            if not success or frame is None:
                log.warning("Camera read failed, retrying...")
                try:
                    cap.release()
                except Exception:
                    pass
                cap = None
                self._stop_event.wait(0.5)
                continue

            # Nén sang JPEG
            try:
                ret, buffer = cv2.imencode(".jpg", frame, encode_param)
                if ret:
                    jpeg_bytes = buffer.tobytes()
                    with self._condition:
                        self._latest_jpeg = jpeg_bytes
                        self._frame_id += 1
                        self._last_frame_time = time.time()
                        self._condition.notify_all()
            except Exception as exc:
                log.error("JPEG encode error: %s", exc)

            # Khống chế tốc độ frame
            time.sleep(1.0 / max(1, self.fps))

        if cap is not None:
            try:
                cap.release()
            except Exception:
                pass

    # ------------------------------------------------------------------ streaming
    def get_latest_jpeg(self) -> bytes:
        with self._lock:
            return self._latest_jpeg

    def register_client(self) -> None:
        with self._lock:
            self._client_count += 1
            if self._client_count == 1 and not self._active:
                self.start()

    def unregister_client(self) -> None:
        with self._lock:
            self._client_count = max(0, self._client_count - 1)
            # Không tắt ngay lập tức, giữ chạy để người dùng đổi tab không bị gián đoạn

    async def frame_generator(self) -> AsyncGenerator[bytes, None]:
        """Tạo luồng MJPEG stream cho FastAPI StreamingResponse."""
        self.register_client()
        last_sent_id = -1
        try:
            while True:
                # Chờ frame mới
                jpeg_data = b""
                loop = asyncio.get_running_loop()

                def wait_for_frame() -> bytes:
                    with self._condition:
                        if not self._active and self._stop_event.is_set():
                            return b""
                        # Nếu đã có frame mới hơn frame vừa gửi
                        if self._frame_id != last_sent_id and self._latest_jpeg:
                            return self._latest_jpeg
                        # Chờ tối đa 0.2s cho frame kế tiếp
                        self._condition.wait(timeout=0.2)
                        return self._latest_jpeg

                jpeg_data = await loop.run_in_executor(None, wait_for_frame)

                if not jpeg_data:
                    # Nếu chưa có frame thì yield frame rỗng hoặc chờ
                    await asyncio.sleep(0.05)
                    continue

                last_sent_id = self._frame_id
                yield (
                    b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n"
                    b"Content-Length: " + str(len(jpeg_data)).encode() + b"\r\n\r\n"
                    + jpeg_data + b"\r\n"
                )
        except (asyncio.CancelledError, GeneratorExit):
            pass
        finally:
            self.unregister_client()

    def status(self) -> dict[str, Any]:
        with self._lock:
            alive = (time.time() - self._last_frame_time) < 3.0 if self._last_frame_time > 0 else False
            return {
                "opencv_installed": cv2 is not None,
                "device": self.device,
                "active": self._active and alive,
                "client_count": self._client_count,
                "fps": self.fps,
                "resolution": f"{self.width}x{self.height}",
                "error": self._error if not alive else "",
            }


# Singleton streamer instance
camera_streamer = CameraStreamer(
    device=int(os.environ.get("CAMERA_DEVICE", 0)) if os.environ.get("CAMERA_DEVICE", "0").isdigit() else os.environ.get("CAMERA_DEVICE", 0),
    width=int(os.environ.get("CAMERA_WIDTH", 640)),
    height=int(os.environ.get("CAMERA_HEIGHT", 480)),
    fps=int(os.environ.get("CAMERA_FPS", 25)),
)
