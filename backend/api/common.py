"""Helper trả response thống nhất: {"ok": bool, "data": ..., "error": {...}}"""
from __future__ import annotations

from typing import Any

from fastapi import HTTPException


def ok(data: Any = None) -> dict[str, Any]:
    if hasattr(data, "model_dump"):
        data = data.model_dump()
    elif isinstance(data, list):
        data = [x.model_dump() if hasattr(x, "model_dump") else x for x in data]
    return {"ok": True, "data": data, "error": None}


def fail(code: str, message: str, status: int = 400) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message})
