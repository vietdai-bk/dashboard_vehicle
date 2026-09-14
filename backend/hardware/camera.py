"""Jetson / USB Camera Streamer — đọc camera cắm trên Jetson (/dev/video*) và phát MJPEG qua HTTP.

Tối ưu hóa cho Jetson Nano / Orin / Raspberry Pi:
- Tự động dò tìm cổng webcam thực tế (/dev/video0, /dev/video1, ...) bằng cách đọc thử frame.
- Cấu hình FourCC 'MJPG' và CAP_PROP_BUFFERSIZE = 1 để triệt tiêu trễ (zero-latency realtime).
- Phát luồng MJPEG đa client đồng thời (không bị lỗi 'device or resource busy').
- Sinh frame thông báo trực quan nếu camera đang bận hoặc chưa sẵn sàng.
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
from typing import Any, AsyncGenerator, Optional, Union

log = logging.getLogger("camera")

try:
    import cv2  # type: ignore
except ImportError:
    cv2 = None


# Ảnh JPEG tối giản 1x1 hợp lệ làm fallback tuyệt đối
MINIMAL_VALID_JPEG = (
    b'\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x01\x00H\x00H\x00\x00\xff\xdb\x00C\x00'
    b'\x08\x06\x06\x07\x06\x05\x08\x07\x07\x07\t\t\x08\n\x0c\x14\r\x0c\x0b\x0b\x0c\x19'
    b'\x12\x13\x0f\x14\x1d\x1a\x1f\x1e\x1d\x1a\x1c\x1c $.\' ",#\x1c\x1c(7),01444\x1f'
    b"'9=82<.342\xff\xc0\x00\x0b\x08\x00\x01\x00\x01\x01\x01\x11\x00\xff\xc4\x00\x1f"
    b"\x00\x00\x01\x05\x01\x01\x01\x01\x01\x01\x00\x00\x00\x00\x00\x00\x00\x00\x01\x02"
    b"\x03\x04\x05\x06\x07\x08\t\n\x0b\xff\xda\x00\x08\x01\x01\x00\x00?\x00\xbf\x00\xff\xd9"
)


def _generate_fallback_jpeg(message: str, subtext: str = "") -> bytes:
    """Tạo frame JPEG thông báo trực quan khi camera đang kết nối hoặc lỗi."""
    if cv2 is not None:
        try:
            import numpy as np
            img = np.zeros((360, 640, 3), dtype=np.uint8)
            img[:] = (20, 16, 12)  # nền xám đậm
            cv2.rectangle(img, (12, 12), (628, 348), (55, 45, 30), 2)
            cv2.putText(img, "VEHICLE DASHBOARD - CAMERA", (30, 50), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 210, 255), 2)
            cv2.putText(img, message[:48], (30, 150), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (50, 50, 240), 2)
            if len(message) > 48:
                cv2.putText(img, message[48:95], (30, 185), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (50, 50, 240), 1)
            if subtext:
                cv2.putText(img, subtext, (30, 240), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (160, 160, 160), 1)
            ret, buf = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), 75])
            if ret:
                return buf.tobytes()
        except Exception:
            pass
    return MINIMAL_VALID_JPEG


class CameraStreamer:
    def __init__(self, device: Union[int, str] = 0, width: int = 640, height: int = 480, fps: int = 25) -> None:
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
        self._opened_device: Optional[Union[int, str]] = None

    # ------------------------------------------------------------------ devices
    @staticmethod
    def list_video_devices() -> list:
        """Liệt kê các cổng video có trên Jetson / Linux (/dev/video*)."""
        devices = []
        if sys.platform.startswith("linux"):
            for path in sorted(glob.glob("/dev/video*")):
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
            devices.append({"id": 0, "name": "Camera 0 (Default USB/Webcam)", "path": "0"})
            devices.append({"id": 1, "name": "Camera 1", "path": "1"})
        return devices

    def set_device(self, device: Union[int, str]) -> None:
        need_restart = False
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

    def _build_candidate_list(self) -> list:
        """Lập danh sách các cổng camera khả dĩ theo thứ tự ưu tiên."""
        candidates = []

        # 1. Cổng được cấu hình
        candidates.append(self.device)
        if isinstance(self.device, str) and self.device.isdigit():
            candidates.append(int(self.device))

        # 2. Các cổng /dev/video* trên Linux (thường /dev/video0, /dev/video1, ...)
        if sys.platform.startswith("linux"):
            for p in sorted(glob.glob("/dev/video*")):
                if p not in candidates:
                    candidates.append(p)
                try:
                    num = int(p.replace("/dev/video", ""))
                    if num not in candidates:
                        candidates.append(num)
                except Exception:
                    pass

        # 3. Các index số fallback
        for idx in (0, 1, 2, 3):
            if idx not in candidates:
                candidates.append(idx)
        return candidates

    def _open_capture(self) -> Any:
        if cv2 is None:
            self._error = "OpenCV (cv2) chưa được cài đặt. Hãy chạy: pip install opencv-python-headless"
            log.error(self._error)
            return None

        candidates = self._build_candidate_list()
        log.info("Searching for video source among candidates: %s", candidates)

        cap = None
        opened_dev = None

        # Thử lần lượt các cổng ứng viên
        for dev in candidates:
            # Trên Linux: thử V4L2 trước, rồi CAP_ANY
            backends = [cv2.CAP_V4L2, cv2.CAP_ANY] if (hasattr(cv2, "CAP_V4L2") and sys.platform.startswith("linux")) else [cv2.CAP_ANY]
            for b in backends:
                try:
                    c = cv2.VideoCapture(dev, b)
                    if not c.isOpened():
                        c.release()
                        continue

                    # Tối ưu hóa trước khi đọc: Đặt định dạng FourCC MJPG và kích thước 640x480
                    # Rất quan trọng trên Jetson: nếu không đặt MJPG trước khi đọc, webcam USB
                    # sẽ mặc định dùng YUYV 1080p gây tràn băng thông USB (select timeout / ENOSPC)
                    try:
                        fourcc = cv2.VideoWriter_fourcc(*'MJPG')
                        c.set(cv2.CAP_PROP_FOURCC, fourcc)
                    except Exception:
                        pass

                    c.set(cv2.CAP_PROP_FRAME_WIDTH, self.width)
                    c.set(cv2.CAP_PROP_FRAME_HEIGHT, self.height)
                    c.set(cv2.CAP_PROP_FPS, self.fps)

                    try:
                        c.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                    except Exception:
                        pass

                    # Thử đọc 1 frame để kiểm tra
                    ret, test_frame = c.read()
                    if not ret or test_frame is None or test_frame.size == 0:
                        # Thử lại 1 lần sau 0.1s (webcam USB thường cần vài ms để khởi động cảm biến)
                        time.sleep(0.1)
                        ret, test_frame = c.read()

                    if ret and test_frame is not None and test_frame.size > 0:
                        cap = c
                        opened_dev = dev
                        log.info("Camera successfully acquired on device %s (backend=%s, size=%dx%d)", dev, b, test_frame.shape[1], test_frame.shape[0])
                        break
                    c.release()
                except Exception as exc:
                    log.debug("Failed opening device %s with backend %s: %s", dev, b, exc)
            if cap is not None:
                break

        if cap is None or not cap.isOpened():
            dev_list = glob.glob("/dev/video*") if sys.platform.startswith("linux") else ["0"]
            self._error = f"Chưa đọc được hình từ webcam (Cổng khả dụng: {dev_list}). Kiểm tra cáp cắm USB."
            log.warning(self._error)
            return None

        self._opened_device = opened_dev
        self._error = ""
        return cap

    def _capture_loop(self) -> None:
        cap = None
        reconnect_delay = 2.0
        encode_param = [int(cv2.IMWRITE_JPEG_QUALITY), self.quality] if cv2 is not None else []

        while not self._stop_event.is_set():
            if cap is None or not cap.isOpened():
                cap = self._open_capture()
                if cap is None or not cap.isOpened():
                    err_msg = self._error or f"Không mở được camera {self.device}"
                    placeholder = _generate_fallback_jpeg(err_msg, "Cắm lại webcam USB vào Jetson")
                    with self._condition:
                        self._latest_jpeg = placeholder
                        self._frame_id += 1
                        self._condition.notify_all()
                    self._stop_event.wait(reconnect_delay)
                    continue

            success, frame = cap.read()
            if not success or frame is None or frame.size == 0:
                log.warning("Camera read empty frame, reconnecting...")
                try:
                    cap.release()
                except Exception:
                    pass
                cap = None
                self._stop_event.wait(1.0)
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

            # Giới hạn tốc độ khung hình
            time.sleep(1.0 / max(1, self.fps))

        if cap is not None:
            try:
                cap.release()
            except Exception:
                pass

    # ------------------------------------------------------------------ streaming
    def get_latest_jpeg(self) -> bytes:
        with self._lock:
            if self._latest_jpeg:
                return self._latest_jpeg
        # Nếu chưa có frame thực tế, trả về frame khởi động
        return _generate_fallback_jpeg("Đang khởi động camera Jetson...", "Vui lòng chờ trong giây lát")

    def register_client(self) -> None:
        with self._lock:
            self._client_count += 1
            if not self._active:
                self.start()

    def unregister_client(self) -> None:
        with self._lock:
            self._client_count = max(0, self._client_count - 1)

    async def frame_generator(self) -> AsyncGenerator[bytes, None]:
        """Tạo luồng MJPEG stream cho FastAPI StreamingResponse."""
        self.register_client()
        last_sent_id = -1
        try:
            while True:
                jpeg_data = b""
                loop = asyncio.get_running_loop()

                def wait_for_frame() -> bytes:
                    with self._condition:
                        if not self._active and self._stop_event.is_set():
                            return b""
                        if self._frame_id != last_sent_id and self._latest_jpeg:
                            return self._latest_jpeg
                        self._condition.wait(timeout=0.3)
                        return self._latest_jpeg

                jpeg_data = await loop.run_in_executor(None, wait_for_frame)

                if not jpeg_data:
                    jpeg_data = _generate_fallback_jpeg(
                        self._error or "Đang kết nối camera...",
                        f"Thiết bị: {self.device}"
                    )

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

    def status(self) -> dict:
        with self._lock:
            alive = (time.time() - self._last_frame_time) < 4.0 if self._last_frame_time > 0 else False
            return {
                "opencv_installed": cv2 is not None,
                "configured_device": self.device,
                "opened_device": self._opened_device,
                "active": self._active and alive,
                "client_count": self._client_count,
                "fps": self.fps,
                "resolution": f"{self.width}x{self.height}",
                "error": self._error if not alive else "",
                "available_devices": glob.glob("/dev/video*") if sys.platform.startswith("linux") else ["0"],
            }


# Singleton streamer instance
camera_streamer = CameraStreamer(
    device=int(os.environ.get("CAMERA_DEVICE", 0)) if os.environ.get("CAMERA_DEVICE", "0").isdigit() else os.environ.get("CAMERA_DEVICE", 0),
    width=int(os.environ.get("CAMERA_WIDTH", 640)),
    height=int(os.environ.get("CAMERA_HEIGHT", 480)),
    fps=int(os.environ.get("CAMERA_FPS", 25)),
)
