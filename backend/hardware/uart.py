"""UARTTelemetryProvider — đọc telemetry từ STM32 qua UART (PySerial).

Cùng interface với MockTelemetryProvider. Một thread đọc từng dòng, parse theo
protocol, đẩy packet về event loop. Lỗi packet / mất kết nối chỉ được log và
tự thử kết nối lại — không bao giờ làm crash server.
"""
from __future__ import annotations

import asyncio
import logging
import threading
import time
from typing import Any, Optional

from ..config import settings
from .protocol import ProtocolError, encode_command, parse_packet
from ..telemetry.provider import CommandResult, TelemetryProvider

log = logging.getLogger("uart")

try:
    import serial  # type: ignore
except ImportError:  # pyserial chưa cài — vẫn import được module để chạy mock
    serial = None


class UARTTelemetryProvider(TelemetryProvider):
    kind = "uart"
    label = "STM32"

    ACK_TIMEOUT_S = 2.0
    RECONNECT_DELAY_S = 2.0

    def __init__(self, port: Optional[str] = None, baudrate: Optional[int] = None) -> None:
        super().__init__()
        self.port = port or settings.uart_port
        self.baudrate = baudrate or settings.uart_baudrate
        self._serial: Any = None
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._connected = False
        self._last_rx = 0.0
        self._last_error = ""
        self._pending_acks: dict[str, asyncio.Future[dict[str, Any]]] = {}
        self._write_lock = threading.Lock()

    # ------------------------------------------------------------------ status
    @property
    def connected(self) -> bool:
        return self._connected and (time.time() - self._last_rx) < settings.uart_timeout_s

    @property
    def detail(self) -> str:
        if self._last_error and not self._connected:
            return self._last_error
        return f"{self.port} @ {self.baudrate}"

    # ------------------------------------------------------------------ lifecycle
    async def start(self) -> None:
        if serial is None:
            raise RuntimeError("pyserial chưa được cài: pip install pyserial")
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._reader_loop, name="uart-reader", daemon=True)
        self._thread.start()
        log.info("UART provider started on %s @ %d", self.port, self.baudrate)

    async def stop(self) -> None:
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=3)
            self._thread = None
        self._close_serial()
        log.info("UART provider stopped")

    def _open_serial(self) -> bool:
        try:
            self._serial = serial.Serial(self.port, self.baudrate, timeout=1)
            self._connected = True
            self._last_rx = time.time()
            self._last_error = ""
            log.info("UART connected: %s", self.port)
            self.emit({"type": "log", "level": "INFO", "message": f"UART connected on {self.port}"})
            return True
        except Exception as exc:  # noqa: BLE001
            self._last_error = str(exc)
            self._connected = False
            return False

    def _close_serial(self) -> None:
        if self._serial is not None:
            try:
                self._serial.close()
            except Exception:  # noqa: BLE001
                pass
            self._serial = None
        self._connected = False

    def _reader_loop(self) -> None:
        """Thread: mở cổng, đọc dòng, parse, emit. Tự reconnect khi lỗi."""
        while not self._stop_event.is_set():
            if self._serial is None and not self._open_serial():
                log.warning("UART open failed (%s), retry in %.0fs", self._last_error, self.RECONNECT_DELAY_S)
                self._stop_event.wait(self.RECONNECT_DELAY_S)
                continue
            try:
                raw = self._serial.readline()
            except Exception as exc:  # noqa: BLE001 — cáp rút / thiết bị mất
                log.error("UART read error: %s", exc)
                self.emit({"type": "log", "level": "ERROR", "message": f"UART disconnected: {exc}"})
                self._last_error = str(exc)
                self._close_serial()
                continue
            if not raw:
                if self._connected and time.time() - self._last_rx > settings.uart_timeout_s:
                    log.warning("UART timeout: no packet for %.1fs", settings.uart_timeout_s)
                continue
            try:
                packet = parse_packet(raw)
            except ProtocolError as exc:
                log.error("Invalid telemetry packet: %s", exc)
                continue
            if packet is None:
                continue
            self._last_rx = time.time()
            self._connected = True
            if packet["type"] == "ack":
                self._resolve_ack(packet)
            self.emit(packet)

    # ------------------------------------------------------------------ commands
    def _resolve_ack(self, packet: dict[str, Any]) -> None:
        fut = self._pending_acks.get(packet.get("command", ""))
        if fut is not None and self._loop is not None and not fut.done():
            self._loop.call_soon_threadsafe(fut.set_result, packet)

    async def send_command(self, command: str, params: Optional[dict[str, Any]] = None) -> CommandResult:
        if self._serial is None or not self._connected:
            return CommandResult(False, "UART not connected")
        loop = asyncio.get_running_loop()
        fut: asyncio.Future[dict[str, Any]] = loop.create_future()
        self._pending_acks[command] = fut
        try:
            data = encode_command(command, params)
            with self._write_lock:
                self._serial.write(data)
                self._serial.flush()
            log.info("UART sent %s (%d bytes)", command, len(data))
            ack = await asyncio.wait_for(fut, timeout=self.ACK_TIMEOUT_S)
            return CommandResult(bool(ack.get("ok")), str(ack.get("message", "")),
                                 {k: v for k, v in ack.items() if k not in ("type", "command", "ok", "message")})
        except asyncio.TimeoutError:
            log.warning("No ACK for %s within %.1fs", command, self.ACK_TIMEOUT_S)
            return CommandResult(False, f"Timeout waiting ACK for {command}")
        except Exception as exc:  # noqa: BLE001
            log.error("UART write failed: %s", exc)
            return CommandResult(False, f"UART write failed: {exc}")
        finally:
            self._pending_acks.pop(command, None)
