"""Cấu hình hệ thống.

Thứ tự ưu tiên: biến môi trường > file .env > mặc định.
Các thông số có thể đổi lúc chạy (từ trang Settings) được lưu ở data/settings.json
và ghi đè lên giá trị ở trên khi khởi động.
"""
from __future__ import annotations

import json
import logging
import os
from dataclasses import asdict, dataclass, field, fields
from pathlib import Path
from typing import Any

log = logging.getLogger("config")

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
FRONTEND_DIST = ROOT / "frontend" / "dist"
SETTINGS_FILE = DATA_DIR / "settings.json"
VERSION = "1.0.0"


def _load_dotenv(path: Path) -> None:
    """Đọc file .env đơn giản (KEY=VALUE), không ghi đè biến môi trường đã có."""
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


_load_dotenv(ROOT / ".env")
_load_dotenv(ROOT / "config.env")


def _env(key: str, default: Any) -> Any:
    raw = os.environ.get(key)
    if raw is None:
        return default
    if isinstance(default, bool):
        return raw.lower() in ("1", "true", "yes", "on")
    if isinstance(default, int):
        return int(raw)
    if isinstance(default, float):
        return float(raw)
    return raw


@dataclass
class Settings:
    # --- kết nối ---
    data_source: str = _env("DATA_SOURCE", "mock")            # mock | uart
    uart_port: str = _env("UART_PORT", "/dev/ttyUSB0")
    uart_baudrate: int = _env("UART_BAUDRATE", 115200)
    uart_timeout_s: float = _env("UART_TIMEOUT", 3.0)         # không có packet quá lâu => DISCONNECTED
    # --- server ---
    server_host: str = _env("SERVER_HOST", "0.0.0.0")
    server_port: int = int(os.environ.get("PORT") or _env("SERVER_PORT", 8000))
    log_level: str = _env("LOG_LEVEL", "INFO")
    # --- auth ---
    auth_enabled: bool = _env("AUTH_ENABLED", True)
    auth_username: str = _env("AUTH_USERNAME", "admin")
    auth_password: str = _env("AUTH_PASSWORD", "admin")
    # --- telemetry / vehicle ---
    telemetry_rate_hz: float = _env("TELEMETRY_RATE_HZ", 5.0)
    vehicle_name: str = _env("VEHICLE_NAME", "DHMR-32000")
    home_lat: float = _env("HOME_LAT", 16.0748)
    home_lon: float = _env("HOME_LON", 108.1500)
    # --- mock ---
    mock_cruise_speed_mps: float = _env("MOCK_CRUISE_SPEED", 6.0)
    mock_turn_rate_dps: float = _env("MOCK_TURN_RATE", 70.0)
    mock_battery_drain_pct_per_min: float = _env("MOCK_BATTERY_DRAIN", 1.5)
    mock_initial_battery: float = _env("MOCK_INITIAL_BATTERY", 92.0)
    acceptance_radius_m: float = _env("ACCEPTANCE_RADIUS", 3.0)
    # --- safety ---
    battery_warn_pct: float = _env("BATTERY_WARN", 30.0)
    battery_critical_pct: float = _env("BATTERY_CRITICAL", 15.0)
    geofence_radius_m: float = _env("GEOFENCE_RADIUS", 1500.0)
    auto_rtl_on_abort: bool = _env("AUTO_RTL_ON_ABORT", False)
    # --- map ---
    map_tiles: str = _env("MAP_TILES", "https://tile.openstreetmap.org/{z}/{x}/{y}.png")
    map_attribution: str = _env("MAP_ATTRIBUTION", "&copy; OpenStreetMap contributors")
    # --- giới hạn bộ nhớ ---
    telemetry_history_size: int = 3600   # số mẫu sensor giữ trong RAM
    event_log_size: int = 1000
    track_max_points: int = 5000

    # các khóa KHÔNG được đổi từ UI (bảo mật / cần restart)
    _locked: tuple = field(default=("server_host", "server_port", "auth_password", "auth_username",
                                    "auth_enabled", "log_level"), repr=False)

    # ---- helpers -------------------------------------------------------------
    def public_dict(self) -> dict[str, Any]:
        """Dữ liệu trả cho frontend (không lộ mật khẩu)."""
        d = {k: v for k, v in asdict(self).items() if not k.startswith("_")}
        d.pop("auth_password", None)
        return d

    def editable_keys(self) -> list[str]:
        return [f.name for f in fields(self) if not f.name.startswith("_") and f.name not in self._locked]

    def update(self, patch: dict[str, Any]) -> dict[str, Any]:
        """Áp dụng thay đổi từ UI, ép kiểu theo giá trị hiện tại. Trả về các khóa đã đổi."""
        changed: dict[str, Any] = {}
        for key, value in patch.items():
            if key not in self.editable_keys():
                continue
            current = getattr(self, key)
            try:
                if isinstance(current, bool):
                    value = bool(value)
                elif isinstance(current, int):
                    value = int(value)
                elif isinstance(current, float):
                    value = float(value)
                else:
                    value = str(value)
            except (TypeError, ValueError) as exc:
                raise ValueError(f"Giá trị không hợp lệ cho {key}: {value}") from exc
            if value != current:
                setattr(self, key, value)
                changed[key] = value
        return changed

    def save(self) -> None:
        DATA_DIR.mkdir(exist_ok=True)
        persist = {k: getattr(self, k) for k in self.editable_keys()}
        SETTINGS_FILE.write_text(json.dumps(persist, indent=2, ensure_ascii=False), encoding="utf-8")

    def load_saved(self) -> None:
        if not SETTINGS_FILE.exists():
            return
        try:
            saved = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
            self.update(saved)
            log.info("Loaded saved settings from %s", SETTINGS_FILE)
        except (json.JSONDecodeError, ValueError) as exc:
            log.warning("Ignoring corrupt settings file: %s", exc)


settings = Settings()
settings.load_saved()
