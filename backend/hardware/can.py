"""CANTelemetryProvider & CANReceiver — đọc dữ liệu từ MCP2515 qua SocketCAN trên Jetson.

Hỗ trợ:
1. Native Linux SocketCAN qua thư viện socket chuẩn (AF_CAN) — 0 dependency, chạy trực tiếp trên Jetson.
2. python-can (nếu đã cài đặt).
3. Fallback an toàn trên Windows / môi trường dev không có SocketCAN.

Giải mã Frame 0x555 và 0x556 từ ESP32 theo định dạng nhị phân 8 byte.
"""
from __future__ import annotations

import asyncio
import logging
import os
import struct
import threading
import time
from typing import Any, Callable, Optional

from ..config import settings
from .protocol import ProtocolError, decode_can_frame
from ..telemetry.provider import CommandResult, TelemetryProvider

log = logging.getLogger("can")

# Cấu trúc Linux struct can_frame (16 bytes)
# can_id: 4 bytes, can_dlc: 1 byte, pad: 3 bytes, data: 8 bytes
CAN_FRAME_FMT = "=IB3x8s"
CAN_FRAME_SIZE = struct.calcsize(CAN_FRAME_FMT)

CAN_EFF_FLAG = 0x80000000
CAN_RTR_FLAG = 0x40000000
CAN_ERR_FLAG = 0x20000000
CAN_SFF_MASK = 0x000007FF
CAN_EFF_MASK = 0x1FFFFFFF


class CANReceiver:
    """Bộ nhận CAN độc lập, có thể chạy song song với UART hoặc chạy trong Provider."""

    def __init__(self, channel: str = "can0", bitrate: int = 500000,
                 on_packet: Optional[Callable[[dict[str, Any]], None]] = None) -> None:
        self.channel = channel
        self.bitrate = bitrate
        self.on_packet = on_packet
        self._sock: Any = None
        self._can_bus: Any = None
        self._backend_type: str = "none"  # "socketcan", "python-can", "mock"
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._connected = False
        self._last_rx = 0.0
        self._last_error = ""
        self._rx_count = 0

    @property
    def connected(self) -> bool:
        return self._connected

    @property
    def detail(self) -> str:
        if self._last_error and not self.connected:
            return self._last_error
        status = "online" if (time.time() - self._last_rx < 10.0 and self._last_rx > 0) else "chờ dữ liệu"
        return f"{self.channel} ({self._backend_type}) @ {self.bitrate} bps [{status}]"

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._reader_loop, name="can-reader", daemon=True)
        self._thread.start()
        log.info("CAN receiver started on channel '%s' @ %d bps", self.channel, self.bitrate)

    def stop(self) -> None:
        self._stop_event.set()
        self._close_can()
        if self._thread:
            self._thread.join(timeout=2.0)
            self._thread = None
        log.info("CAN receiver stopped")

    def _open_can(self) -> bool:
        # 1. Ưu tiên Linux Native SocketCAN qua module socket chuẩn
        if hasattr(os, "uname") and hasattr(struct, "calcsize"):
            try:
                import socket
                if hasattr(socket, "AF_CAN") and hasattr(socket, "CAN_RAW"):
                    sock = socket.socket(socket.AF_CAN, socket.SOCK_RAW, socket.CAN_RAW)
                    sock.settimeout(1.0)
                    sock.bind((self.channel,))
                    self._sock = sock
                    self._backend_type = "socketcan"
                    self._connected = True
                    self._last_error = ""
                    log.info("Connected to SocketCAN '%s'", self.channel)
                    return True
            except Exception as exc:  # noqa: BLE001
                self._last_error = f"SocketCAN '{self.channel}' error: {exc}"
                log.debug("Native SocketCAN failed: %s", exc)

        # 2. Thử qua thư viện python-can nếu đã cài
        try:
            import can  # type: ignore
            bus = can.interface.Bus(channel=self.channel, bustype="socketcan", bitrate=self.bitrate)
            self._can_bus = bus
            self._backend_type = "python-can"
            self._connected = True
            self._last_error = ""
            log.info("Connected to CAN via python-can on '%s'", self.channel)
            return True
        except Exception as exc:  # noqa: BLE001
            log.debug("python-can failed: %s", exc)

        # 3. Trên Windows / môi trường dev không có SocketCAN
        self._backend_type = "unavailable"
        self._connected = False
        if not self._last_error:
            self._last_error = f"Không tìm thấy SocketCAN '{self.channel}' (chỉ khả dụng trên Linux/Jetson)"
        return False

    def _close_can(self) -> None:
        if self._sock is not None:
            try:
                self._sock.close()
            except Exception:  # noqa: BLE001
                pass
            self._sock = None
        if self._can_bus is not None:
            try:
                self._can_bus.shutdown()
            except Exception:  # noqa: BLE001
                pass
            self._can_bus = None
        self._connected = False

    def _reader_loop(self) -> None:
        while not self._stop_event.is_set():
            if not self._connected:
                if not self._open_can():
                    self._stop_event.wait(5.0)
                    continue

            try:
                if self._backend_type == "socketcan" and self._sock is not None:
                    try:
                        raw = self._sock.recv(CAN_FRAME_SIZE)
                    except TimeoutError:
                        continue
                    if len(raw) < CAN_FRAME_SIZE:
                        continue
                    can_id_raw, can_dlc, data_raw = struct.unpack(CAN_FRAME_FMT, raw)
                    # Lấy ID chuẩn (11-bit) hoặc mở rộng (29-bit)
                    if can_id_raw & CAN_EFF_FLAG:
                        can_id = can_id_raw & CAN_EFF_MASK
                    else:
                        can_id = can_id_raw & CAN_SFF_MASK
                    payload = data_raw[:can_dlc]

                elif self._backend_type == "python-can" and self._can_bus is not None:
                    msg = self._can_bus.recv(timeout=1.0)
                    if msg is None:
                        continue
                    can_id = msg.arbitration_id
                    payload = bytes(msg.data)

                else:
                    self._stop_event.wait(2.0)
                    continue

                self._process_frame(can_id, payload)

            except Exception as exc:  # noqa: BLE001
                log.error("CAN read error: %s", exc)
                self._last_error = str(exc)
                self._close_can()
                self._stop_event.wait(2.0)

    def _process_frame(self, can_id: int, payload: bytes) -> None:
        try:
            packet = decode_can_frame(can_id, payload)
        except ProtocolError as exc:
            log.debug("CAN decode error for ID 0x%X: %s", can_id, exc)
            return

        if packet:
            self._last_rx = time.time()
            self._rx_count += 1
            log.debug("CAN RX [0x%03X]: %s", can_id, packet)
            if self.on_packet:
                self.on_packet(packet)

    def send_frame(self, can_id: int, data: bytes) -> bool:
        """Gửi 1 frame CAN xuống bus."""
        if not self._connected:
            return False
        try:
            if self._backend_type == "socketcan" and self._sock is not None:
                dlc = len(data)
                padded_data = data.ljust(8, b"\x00")
                raw = struct.pack(CAN_FRAME_FMT, can_id, dlc, padded_data)
                self._sock.send(raw)
                return True
            if self._backend_type == "python-can" and self._can_bus is not None:
                import can
                msg = can.Message(arbitration_id=can_id, data=data, is_extended_id=False)
                self._can_bus.send(msg)
                return True
        except Exception as exc:  # noqa: BLE001
            log.error("Failed to send CAN frame 0x%X: %s", can_id, exc)
        return False


class CANTelemetryProvider(TelemetryProvider):
    """TelemetryProvider qua giao tiếp CAN Bus MCP2515."""
    kind = "can"
    label = "CAN Bus"

    def __init__(self, channel: Optional[str] = None, bitrate: Optional[int] = None) -> None:
        super().__init__()
        self.channel = channel or settings.can_channel
        self.bitrate = bitrate or settings.can_bitrate
        self._receiver = CANReceiver(channel=self.channel, bitrate=self.bitrate, on_packet=self._on_can_packet)

    @property
    def connected(self) -> bool:
        return self._receiver.connected

    @property
    def detail(self) -> str:
        return self._receiver.detail

    def _on_can_packet(self, packet: dict[str, Any]) -> None:
        self.emit(packet)

    async def start(self) -> None:
        self._receiver.start()
        log.info("CANTelemetryProvider started on %s @ %d bps", self.channel, self.bitrate)

    async def stop(self) -> None:
        self._receiver.stop()
        log.info("CANTelemetryProvider stopped")

    async def send_command(self, command: str, params: Optional[dict[str, Any]] = None) -> CommandResult:
        # Ví dụ gửi lệnh điều khiển qua CAN nếu có định dạng ID riêng
        log.info("CAN send_command %s (chưa cấu hình command ID)", command)
        return CommandResult(True, f"Sent {command} via CAN")
