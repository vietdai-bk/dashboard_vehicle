"""Xác thực cơ bản: username/password từ .env, token trong bộ nhớ.
Thiết kế để thay bằng JWT/session/database sau này mà không đổi API."""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import secrets
import time
from typing import Optional

from fastapi import Depends, HTTPException, Request, status

from ..config import DATA_DIR, settings

TOKEN_TTL_S = 12 * 3600
TOKEN_FILE = DATA_DIR / "tokens.json"
log = logging.getLogger("auth")


class AuthManager:
    def __init__(self) -> None:
        self._salt = secrets.token_hex(8)
        self._pw_hash = self._hash(settings.auth_password)
        self._tokens: dict[str, dict] = {}
        self._load()

    # token được lưu (đã hash) để restart server không đăng xuất người dùng
    def _load(self) -> None:
        if not TOKEN_FILE.exists():
            return
        try:
            raw = json.loads(TOKEN_FILE.read_text(encoding="utf-8"))
            now = time.time()
            self._tokens = {k: v for k, v in raw.items() if now - v.get("created", 0) < TOKEN_TTL_S}
        except (OSError, json.JSONDecodeError) as exc:
            log.warning("Cannot load tokens: %s", exc)

    def _persist(self) -> None:
        try:
            DATA_DIR.mkdir(exist_ok=True)
            TOKEN_FILE.write_text(json.dumps(self._tokens), encoding="utf-8")
        except OSError as exc:
            log.warning("Cannot persist tokens: %s", exc)

    @staticmethod
    def _key(token: str) -> str:
        return hashlib.sha256(token.encode()).hexdigest()

    def _hash(self, password: str) -> str:
        return hashlib.sha256((self._salt + password).encode()).hexdigest()

    def login(self, username: str, password: str) -> Optional[str]:
        if username != settings.auth_username or not hmac.compare_digest(self._hash(password), self._pw_hash):
            return None
        token = secrets.token_urlsafe(32)
        self._tokens[self._key(token)] = {"username": username, "created": time.time()}
        self._persist()
        return token

    def logout(self, token: str) -> None:
        self._tokens.pop(self._key(token), None)
        self._persist()

    def user_for(self, token: Optional[str]) -> Optional[dict]:
        if not token:
            return None
        key = self._key(token)
        info = self._tokens.get(key)
        if info and time.time() - info["created"] < TOKEN_TTL_S:
            return info
        if key in self._tokens:
            self._tokens.pop(key)
            self._persist()
        return None


auth_manager = AuthManager()


def _extract_token(request: Request) -> Optional[str]:
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        return header[7:].strip()
    return request.query_params.get("token")


def require_auth(request: Request) -> dict:
    """Dependency cho các endpoint cần đăng nhập. Tắt qua AUTH_ENABLED=false."""
    if not settings.auth_enabled:
        return {"username": "guest"}
    user = auth_manager.user_for(_extract_token(request))
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail={"code": "UNAUTHORIZED", "message": "Login required"})
    return user


CurrentUser = Depends(require_auth)
