"""Event log + Alert engine."""
from __future__ import annotations

import json
import logging
import time
from collections import deque
from pathlib import Path
from typing import Callable, Optional

from ..config import DATA_DIR, settings
from ..models import Alert, EventEntry

log = logging.getLogger("events")
Broadcaster = Callable[[dict], None]


class EventLog:
    def __init__(self, broadcaster: Broadcaster, path: Path = DATA_DIR / "events.jsonl") -> None:
        self._events: deque[EventEntry] = deque(maxlen=settings.event_log_size)
        self._next_id = 1
        self._broadcast = broadcaster
        self._path = path
        self._load()

    def _load(self) -> None:
        if not self._path.exists():
            return
        try:
            lines = self._path.read_text(encoding="utf-8").splitlines()[-settings.event_log_size:]
            for line in lines:
                line = line.strip()
                if not line:
                    continue
                entry = EventEntry(**json.loads(line))
                self._events.append(entry)
                self._next_id = max(self._next_id, entry.id + 1)
        except Exception as exc:  # noqa: BLE001
            log.warning("Could not load event log: %s", exc)

    def add(self, level: str, category: str, message: str) -> EventEntry:
        entry = EventEntry(id=self._next_id, timestamp=time.time(), level=level.upper(),
                           category=category, message=message)
        self._next_id += 1
        self._events.append(entry)
        try:
            with self._path.open("a", encoding="utf-8") as fh:
                fh.write(entry.model_dump_json() + "\n")
        except OSError as exc:
            log.warning("Cannot persist event: %s", exc)
        getattr(log, level.lower(), log.info)("[%s] %s", category, message)
        self._broadcast({"type": "event", "data": entry.model_dump()})
        return entry

    def list(self, limit: int = 200, category: Optional[str] = None) -> list[EventEntry]:
        items = [e for e in self._events if category is None or e.category == category]
        return list(items)[-limit:][::-1]

    def clear(self) -> None:
        self._events.clear()
        try:
            self._path.write_text("", encoding="utf-8")
        except OSError:
            pass


class AlertManager:
    """Cảnh báo có khóa (key): raise một lần, tự clear khi hết điều kiện."""

    def __init__(self, broadcaster: Broadcaster, events: EventLog) -> None:
        self._alerts: dict[str, Alert] = {}
        self._history: deque[Alert] = deque(maxlen=200)
        self._next_id = 1
        self._broadcast = broadcaster
        self._events = events

    def raise_alert(self, key: str, level: str, message: str) -> Alert:
        existing = self._alerts.get(key)
        if existing and existing.active and existing.level == level:
            return existing
        alert = Alert(id=self._next_id, key=key, level=level, message=message, timestamp=time.time())  # type: ignore[arg-type]
        self._next_id += 1
        self._alerts[key] = alert
        self._history.append(alert)
        self._events.add("WARNING" if level != "critical" else "ERROR", "alert", message)
        self._broadcast({"type": "alert", "data": alert.model_dump()})
        return alert

    def clear(self, key: str) -> None:
        alert = self._alerts.get(key)
        if alert and alert.active:
            alert.active = False
            self._events.add("INFO", "alert", f"Cleared: {alert.message}")
            self._broadcast({"type": "alert", "data": alert.model_dump()})

    def acknowledge(self, alert_id: int) -> Optional[Alert]:
        for alert in self._alerts.values():
            if alert.id == alert_id:
                alert.acknowledged = True
                self._broadcast({"type": "alert", "data": alert.model_dump()})
                return alert
        return None

    def list(self, active_only: bool = False) -> list[Alert]:
        items = list(self._history)
        if active_only:
            items = [a for a in items if a.active]
        return items[::-1]
