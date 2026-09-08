from fastapi import APIRouter, Request

from ..config import settings
from ..core.auth import CurrentUser, _extract_token, auth_manager
from ..models import LoginRequest
from .common import fail, ok

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/status")
def auth_status(request: Request) -> dict:
    user = auth_manager.user_for(_extract_token(request)) if settings.auth_enabled else {"username": "guest"}
    return ok({"auth_enabled": settings.auth_enabled, "authenticated": user is not None,
               "username": user["username"] if user else None})


@router.post("/login")
def login(body: LoginRequest) -> dict:
    token = auth_manager.login(body.username, body.password)
    if token is None:
        raise fail("INVALID_CREDENTIALS", "Wrong username or password", 401)
    return ok({"token": token, "username": body.username})


@router.post("/logout")
def logout(request: Request, user: dict = CurrentUser) -> dict:
    auth_manager.logout(_extract_token(request) or "")
    return ok({"logged_out": True})


@router.get("/me")
def me(user: dict = CurrentUser) -> dict:
    return ok({"username": user["username"]})
