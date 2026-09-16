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
        # Khi serial port đang mở thành công, giữ trạng thái kết nối sẵn sàng chờ STM32 gửi
        return self._connected and self._serial is not None and getattr(self._serial, "is_open", False)

    @property
    def detail(self) -> str:
        if self._last_error and not self.connected:
            return self._last_error
        status = "sẵn sàng chờ dữ liệu" if (time.time() - self._last_rx > 10.0) else "online"
        return f"{self.port} @ {self.baudrate} ({status})"

    # ------------------------------------------------------------------ lifecycle
    async def start(self) -> None:
        if serial is None:
            raise RuntimeError("pyserial chưa được cài: pip install pyserial")
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._reader_loop, name="uart-reader", daemon=True)
        self._thread.start()
        log.info("UART provider started, waiting for STM32 on %s @ %d", self.port, self.baudrate)

    async def stop(self) -> None:
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=3)
            self._thread = None
        self._close_serial()
        log.info("UART provider stopped")

    def _find_candidate_port(self) -> Optional[str]:
        if serial is None:
            return None
        try:
            import serial.tools.list_ports as lp
            ports = list(lp.comports())
            if not ports:
                return None
            for p in ports:
                desc = (p.description or "").lower()
                if any(x in desc for x in ("stm", "ch340", "cp210", "ftdi", "usb serial", "prolific", "uart")):
                    return p.device
            return ports[0].device
        except Exception:
            return None

    def _open_serial(self) -> bool:
        ports_to_try = [self.port]
        candidate = self._find_candidate_port()
        if candidate and candidate not in ports_to_try:
            ports_to_try.append(candidate)

        last_exc = None
        for port in ports_to_try:
            if not port:
                continue
            try:
                self._serial = serial.Serial(port, self.baudrate, timeout=1)
                self.port = port
                self._connected = True
                self._last_rx = time.time()
                self._last_error = ""
                log.info("UART connected: %s @ %d (chờ STM32 gửi dữ liệu...)", port, self.baudrate)
                self.emit({"type": "log", "level": "INFO", "message": f"UART connected on {port} @ {self.baudrate}. Sẵn sàng chờ STM32 gửi..."})
                return True
            except Exception as exc:  # noqa: BLE001
                last_exc = exc

        self._last_error = str(last_exc) if last_exc else "No available serial port"
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
        """Thread: mở cổng, luôn ở trạng thái chờ STM32 gửi dữ liệu, parse và emit ngay lên web."""
        while not self._stop_event.is_set():
            if self._serial is None or not getattr(self._serial, "is_open", False):
                if not self._open_serial():
                    self._stop_event.wait(self.RECONNECT_DELAY_S)
                    continue
            try:
                raw = self._serial.readline()
                print("stm32 send: %s\r\n", raw)
            except Exception as exc:  # noqa: BLE001 — cáp rút / thiết bị mất
                log.error("UART read error: %s", exc)
                self.emit({"type": "log", "level": "ERROR", "message": f"UART disconnected: {exc}"})
                self._last_error = str(exc)
                self._close_serial()
                continue

            if not raw:
                # Chờ STM32 gửi dữ liệu tiếp theo
                continue

            try:
                packet = parse_packet(raw)
            except ProtocolError as exc:
                log.debug("UART unparsed line: %s (%s)", raw[:80], exc)
                continue

            if packet is None:
                continue

            self._last_rx = time.time()
            self._connected = True
            log.debug("UART RX: %s", packet)
            if packet.get("type") == "ack":
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
            print(f"\n[JETSON UART TX -> STM32] ({len(data)} bytes):", flush=True)
            print(f"RAW STR: {data.decode('utf-8', errors='replace').strip()}", flush=True)
            print(f"RAW BYTES: {data}\n", flush=True)
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
