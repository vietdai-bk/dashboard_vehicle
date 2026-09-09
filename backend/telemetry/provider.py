"""Interface chung cho mọi nguồn telemetry. Mock và UART đều implement lớp này."""
from __future__ import annotations

import asyncio
from abc import ABC, abstractmethod
from typing import Any, Awaitable, Callable, Dict, Optional

PacketHandler = Callable[[Dict[str, Any]], None]


class CommandResult:
    """Kết quả một lệnh gửi xuống vehicle (ACK)."""

    def __init__(self, ok: bool, message: str = "", data: Optional[dict[str, Any]] = None) -> None:
        self.ok = ok
        self.message = message
        self.data = data or {}

    def to_dict(self) -> dict[str, Any]:
        return {"ok": self.ok, "message": self.message, **self.data}


class TelemetryProvider(ABC):
    """Nguồn dữ liệu vehicle. Đẩy packet (đã parse theo protocol) lên on_packet."""

    kind: str = "abstract"     # "mock" | "uart"
    label: str = "ABSTRACT"    # tên hiển thị trên top bar

    def __init__(self) -> None:
        self._on_packet: Optional[PacketHandler] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    def bind(self, loop: asyncio.AbstractEventLoop, on_packet: PacketHandler) -> None:
        self._loop = loop
        self._on_packet = on_packet

    def emit(self, packet: dict[str, Any]) -> None:
        """Gọi được từ bất kỳ thread nào; packet được xử lý trên event loop chính."""
        if self._on_packet is None or self._loop is None or self._loop.is_closed():
            return
        self._loop.call_soon_threadsafe(self._on_packet, packet)

    @property
    @abstractmethod
    def connected(self) -> bool: ...

    @property
    def detail(self) -> str:
        return ""

    @abstractmethod
    async def start(self) -> None: ...

    @abstractmethod
    async def stop(self) -> None: ...

    @abstractmethod
    async def send_command(self, command: str, params: Optional[dict[str, Any]] = None) -> CommandResult: ...


ProviderFactory = Callable[[], Awaitable[TelemetryProvider]]
