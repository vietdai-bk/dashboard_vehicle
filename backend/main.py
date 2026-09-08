"""Entry point: FastAPI app + WebSocket + phục vụ frontend build.

Chạy:  python backend/main.py   hoặc   python server.py
       uvicorn backend.main:app --host 0.0.0.0 --port 8000
"""
from __future__ import annotations

import asyncio
import logging
import mimetypes
import sys
from contextlib import asynccontextmanager
from pathlib import Path

# Fix MIME types on Windows where .js might be registered as text/plain in Windows Registry
mimetypes.init()
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("application/javascript", ".mjs")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("application/json", ".json")
mimetypes.add_type("image/png", ".png")
mimetypes.add_type("image/jpeg", ".jpg")

# cho phép `python backend/main.py` chạy trực tiếp
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect  # noqa: E402
from fastapi.exceptions import RequestValidationError  # noqa: E402
from fastapi.responses import FileResponse, JSONResponse  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402

from backend.api import auth, config, mission, telemetry, vehicle  # noqa: E402
from backend.api.vehicle import build_provider  # noqa: E402
from backend.config import FRONTEND_DIST, VERSION, settings  # noqa: E402
from backend.core.auth import auth_manager  # noqa: E402
from backend.core.state import store  # noqa: E402
from backend.core.websocket import manager as ws_manager  # noqa: E402
from backend.mission.manager import MissionManager  # noqa: E402

logging.basicConfig(level=getattr(logging, settings.log_level.upper(), logging.INFO),
                    format="[%(levelname)s] %(name)s: %(message)s")
log = logging.getLogger("main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    ws_manager.bind_loop(asyncio.get_running_loop())
    MissionManager(store)
    try:
        await store.set_provider(build_provider(settings.data_source, settings.uart_port, settings.uart_baudrate))
    except Exception as exc:  # noqa: BLE001 — ví dụ UART không có: server vẫn lên, UI báo DISCONNECTED
        log.error("Data source '%s' failed to start: %s", settings.data_source, exc)
    log.info("Vehicle dashboard v%s ready on http://%s:%d", VERSION, settings.server_host, settings.server_port)
    yield
    await store.shutdown()


app = FastAPI(title="Vehicle Dashboard", version=VERSION, lifespan=lifespan)
for r in (auth.router, vehicle.router, mission.router, telemetry.router, config.router):
    app.include_router(r)


# ---- lỗi trả về cùng định dạng {"ok": false, "error": {...}} --------------------------
@app.exception_handler(HTTPException)
async def http_error(_: Request, exc: HTTPException) -> JSONResponse:
    detail = exc.detail if isinstance(exc.detail, dict) else {"code": "HTTP_ERROR", "message": str(exc.detail)}
    return JSONResponse(status_code=exc.status_code, content={"ok": False, "data": None, "error": detail})


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    first = exc.errors()[0] if exc.errors() else {}
    loc = ".".join(str(x) for x in first.get("loc", []) if x != "body")
    message = f"{loc}: {first.get('msg', 'invalid')}" if loc else "Invalid request"
    return JSONResponse(status_code=422, content={"ok": False, "data": None,
                                                  "error": {"code": "VALIDATION_ERROR", "message": message}})


@app.exception_handler(Exception)
async def unhandled_error(_: Request, exc: Exception) -> JSONResponse:
    log.exception("Unhandled server error")
    return JSONResponse(status_code=500, content={"ok": False, "data": None,
                                                  "error": {"code": "SERVER_ERROR", "message": str(exc)}})


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "data": {"version": VERSION, "source": settings.data_source}, "error": None}


# ---- WebSocket telemetry -------------------------------------------------------------
@app.websocket("/ws/telemetry")
async def ws_telemetry(ws: WebSocket) -> None:
    if settings.auth_enabled and auth_manager.user_for(ws.query_params.get("token")) is None:
        await ws.close(code=4401)
        return
    await ws_manager.connect(ws)
    try:
        await ws_manager.send(ws, {"type": "snapshot", "data": store.snapshot()})
        while True:
            # client có thể gửi "ping"; mọi thứ khác bỏ qua
            msg = await ws.receive_text()
            if msg == "ping":
                await ws_manager.send(ws, {"type": "pong", "data": None})
    except WebSocketDisconnect:
        pass
    except Exception as exc:  # noqa: BLE001
        log.debug("WebSocket closed: %s", exc)
    finally:
        await ws_manager.disconnect(ws)


@app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"], include_in_schema=False)
async def api_not_found(path: str) -> JSONResponse:
    """API không tồn tại: trả lỗi thống nhất thay vì rơi vào SPA fallback."""
    return JSONResponse(status_code=404, content={"ok": False, "data": None,
                                                  "error": {"code": "NOT_FOUND", "message": f"/api/{path} not found"}})


# ---- frontend (SPA) ------------------------------------------------------------------
if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str):
        candidate = FRONTEND_DIST / path
        if path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIST / "index.html")
else:
    @app.get("/", include_in_schema=False)
    async def no_frontend():
        return JSONResponse({"ok": False, "error": {"code": "NO_FRONTEND",
                             "message": "frontend/dist not found. Run: cd frontend && npm install && npm run build"}})


def run() -> None:
    import uvicorn
    uvicorn.run("backend.main:app", host=settings.server_host, port=settings.server_port,
                log_level=settings.log_level.lower(), ws_ping_interval=20, ws_ping_timeout=20)


if __name__ == "__main__":
    run()
