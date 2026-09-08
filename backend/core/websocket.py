"""Quản lý WebSocket client và broadcast."""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from fastapi import WebSocket

log = logging.getLogger("ws")


class ConnectionManager:
    def __init__(self) -> None:
        self._clients: set[WebSocket] = set()
        self._lock = asyncio.Lock()
        self._loop: asyncio.AbstractEventLoop | None = None

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """Ghi nhớ event loop chính để broadcast được từ thread khác (sync endpoint, UART thread)."""
        self._loop = loop

    @property
    def count(self) -> int:
        return len(self._clients)

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._clients.add(ws)
        log.info("WebSocket client connected (%d total)", len(self._clients))

    async def disconnect(self, ws: WebSocket) -> None:
        async with self._lock:
            self._clients.discard(ws)
        log.info("WebSocket client disconnected (%d total)", len(self._clients))

    async def send(self, ws: WebSocket, message: dict[str, Any]) -> None:
        await ws.send_text(json.dumps(message, ensure_ascii=False))

    async def broadcast(self, message: dict[str, Any]) -> None:
        if not self._clients:
            return
        text = json.dumps(message, ensure_ascii=False)
        dead: list[WebSocket] = []
        for ws in list(self._clients):
            try:
                await ws.send_text(text)
            except Exception:  # noqa: BLE001 — client đã đóng
                dead.append(ws)
        for ws in dead:
            await self.disconnect(ws)

    def broadcast_nowait(self, message: dict[str, Any]) -> None:
        """Dùng từ code đồng bộ. An toàn khi gọi từ threadpool của FastAPI (sync endpoint)
        hoặc thread đọc UART: lệnh được chuyển về event loop chính."""
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None
        if loop is not None and loop is self._loop or (loop is not None and self._loop is None):
            loop.create_task(self.broadcast(message))
        elif self._loop is not None and not self._loop.is_closed():
            self._loop.call_soon_threadsafe(lambda: asyncio.ensure_future(self.broadcast(message)))
        else:
            log.debug("No event loop available, dropping broadcast %s", message.get("type"))


manager = ConnectionManager()
