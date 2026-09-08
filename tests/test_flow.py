"""End-to-end test chạy trên server thật (python server.py đang chạy ở BASE).

    python tests/test_flow.py            # server ở http://127.0.0.1:8000
    BASE=http://pi.local:8000 python tests/test_flow.py

Kiểm tra: auth, REST, WebSocket, waypoint CRUD/reorder, save/load, ARM/UPLOAD/START/
PAUSE/RESUME/STOP/ABORT, mock vehicle chạy qua 4 WP, telemetry/battery/track/progress
cập nhật realtime, history, events, alerts, settings, WS reconnect.
"""
from __future__ import annotations

import asyncio
import json
import math
import os
import sys
import time

import httpx
import websockets

BASE = os.environ.get("BASE", "http://127.0.0.1:8000")
WS = BASE.replace("http", "ws") + "/ws/telemetry"
USER, PASS = os.environ.get("AUTH_USERNAME", "admin"), os.environ.get("AUTH_PASSWORD", "admin")

RESULTS: list[tuple[str, bool, str]] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    RESULTS.append((name, bool(cond), detail))
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


def hav(a: list[float], b: list[float]) -> float:
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    x = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(b[1] - a[1]) / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(x))


async def main() -> int:
    c = httpx.AsyncClient(base_url=BASE, timeout=10)

    print("\n== 1. Backend / auth ==")
    h = (await c.get("/api/health")).json()
    check("backend up (/api/health)", h["ok"], f"v{h['data']['version']} source={h['data']['source']}")
    r = await c.get("/")
    check("frontend served at /", r.status_code == 200 and "text/html" in r.headers["content-type"] and "<div id=\"root\"" in r.text)
    r = await c.get("/telemetry")
    check("SPA fallback (/telemetry -> index.html)", r.status_code == 200 and "text/html" in r.headers["content-type"])
    bad = (await c.post("/api/vehicle/arm")).json()
    check("protected endpoint rejects without token", bad["ok"] is False and bad["error"]["code"] == "UNAUTHORIZED")
    bad = (await c.post("/api/auth/login", json={"username": USER, "password": "wrong"})).json()
    check("wrong password rejected", bad["error"]["code"] == "INVALID_CREDENTIALS")
    tok = (await c.post("/api/auth/login", json={"username": USER, "password": PASS})).json()["data"]["token"]
    c.headers["Authorization"] = f"Bearer {tok}"
    me = (await c.get("/api/auth/me")).json()
    check("login + /me", me["ok"] and me["data"]["username"] == USER)
    nf = (await c.get("/api/does/not/exist")).json()
    check("unknown API -> unified 404", nf["ok"] is False and nf["error"]["code"] == "NOT_FOUND")

    print("\n== 2. Connection / mock source ==")
    conn = (await c.post("/api/vehicle/connect", json={"source": "mock"})).json()["data"]
    check("connect mock", conn["connected"] and conn["label"] == "MOCK ● ACTIVE", conn["label"])
    await asyncio.sleep(0.6)
    v = (await c.get("/api/vehicle/state")).json()["data"]
    check("vehicle state present", v["connected"] and v["battery"] > 0 and v["latitude"] != 0, f"batt={v['battery']} state={v['state']}")

    print("\n== 3. WebSocket ==")
    ws = await websockets.connect(f"{WS}?token={tok}")
    first = json.loads(await asyncio.wait_for(ws.recv(), 3))
    check("ws snapshot first", first["type"] == "snapshot" and "vehicle" in first["data"] and "mission" in first["data"])
    types: dict[str, int] = {}
    t0 = time.time()
    while time.time() - t0 < 2.5:
        m = json.loads(await asyncio.wait_for(ws.recv(), 3))
        types[m["type"]] = types.get(m["type"], 0) + 1
    check("ws streams vehicle+telemetry", types.get("vehicle", 0) >= 8 and types.get("telemetry", 0) >= 2, str(types))
    await ws.send("ping")
    got_pong = False
    for _ in range(30):
        m = json.loads(await asyncio.wait_for(ws.recv(), 3))
        if m["type"] == "pong":
            got_pong = True
            break
    check("ws ping/pong", got_pong)
    bad_ws_closed = False
    try:
        bws = await websockets.connect(f"{WS}?token=invalid")
        await asyncio.wait_for(bws.recv(), 3)
    except websockets.exceptions.ConnectionClosed as exc:
        bad_ws_closed = exc.code == 4401
    except Exception:  # noqa: BLE001
        bad_ws_closed = True
    check("ws rejects bad token (4401)", bad_ws_closed)

    print("\n== 4. Waypoints CRUD ==")
    await c.post("/api/mission/new")
    home = (v["home_latitude"], v["home_longitude"])
    pts = [(home[0] + 0.0006, home[1] + 0.0004), (home[0] + 0.0010, home[1] + 0.0012),
           (home[0] + 0.0003, home[1] + 0.0016), (home[0] - 0.0003, home[1] + 0.0007)]
    ids = []
    for la, lo in pts:
        r = (await c.post("/api/mission/waypoints", json={"latitude": la, "longitude": lo})).json()
        ids.append(r["data"]["waypoint"]["id"])
    m = (await c.get("/api/mission")).json()["data"]
    check("4 waypoints created -> READY", len(m["waypoints"]) == 4 and m["status"] == "READY", f"route {m['distance_total_m']} m")
    bad = (await c.post("/api/mission/waypoints", json={"latitude": 123, "longitude": 0})).json()
    check("invalid waypoint rejected (422)", bad["ok"] is False)
    r = (await c.put(f"/api/mission/waypoints/{ids[1]}", json={"altitude": 25, "name": "Tower"})).json()["data"]["waypoint"]
    check("edit waypoint", r["altitude"] == 25 and r["name"] == "Tower")
    extra = (await c.post("/api/mission/waypoints", json={"latitude": home[0], "longitude": home[1] + 0.003})).json()["data"]["waypoint"]["id"]
    m = (await c.request("DELETE", f"/api/mission/waypoints/{extra}")).json()["data"]
    check("delete waypoint", len(m["waypoints"]) == 4 and all(w["id"] != extra for w in m["waypoints"]))
    rev = list(reversed(ids))
    m = (await c.put("/api/mission/waypoints/reorder", json={"ids": rev})).json()["data"]
    check("reorder waypoints", [w["id"] for w in m["waypoints"]] == rev and m["waypoints"][0]["order"] == 1)
    bad = (await c.put("/api/mission/waypoints/reorder", json={"ids": ids[:2]})).json()
    check("bad reorder rejected", bad["error"]["code"] == "INVALID_ORDER")
    m = (await c.put("/api/mission/waypoints/reorder", json={"ids": ids})).json()["data"]
    check("restore order", [w["id"] for w in m["waypoints"]] == ids)

    print("\n== 5. Save / load mission ==")
    saved = (await c.post("/api/mission/saved", json={"name": "QA square"})).json()["data"]
    check("save mission", saved["name"] == "QA square" and len(saved["waypoints"]) == 4)
    lst = (await c.get("/api/mission/saved")).json()["data"]
    check("list saved", any(s["id"] == saved["id"] for s in lst))
    await c.post("/api/mission/new")
    m = (await c.get("/api/mission")).json()["data"]
    check("new mission empty", m["status"] == "EMPTY" and not m["waypoints"])
    m = (await c.post(f"/api/mission/saved/{saved['id']}/load")).json()["data"]
    check("load mission", m["name"] == "QA square" and len(m["waypoints"]) == 4 and m["status"] == "READY")
    ids = [w["id"] for w in m["waypoints"]]

    print("\n== 6. Safety state machine ==")
    bad = (await c.post("/api/mission/start")).json()
    check("START blocked when DISARMED", bad["error"]["code"] == "NOT_ARMED", bad["error"]["message"])
    r = (await c.post("/api/vehicle/arm")).json()
    check("ARM ack", r["ok"] and r["data"]["ok"], r["data"]["message"])
    bad = (await c.post("/api/mission/start")).json()
    check("START blocked when not uploaded", bad["error"]["code"] == "NOT_UPLOADED")
    await c.post("/api/vehicle/disarm")
    await c.post("/api/mission/new")
    bad = (await c.post("/api/mission/upload")).json()
    check("UPLOAD empty mission blocked", bad["error"]["code"] == "EMPTY_MISSION")
    await c.post(f"/api/mission/saved/{saved['id']}/load")
    m = (await c.post("/api/mission/upload")).json()["data"]
    check("UPLOAD -> UPLOADED (ACK simulated)", m["status"] == "UPLOADED" and m["uploaded"], m["upload_message"])
    r = (await c.put(f"/api/mission/waypoints/{ids[0]}", json={"altitude": 5})).json()["data"]["mission"]
    check("edit after upload invalidates upload", r["uploaded"] is False and r["status"] == "READY")
    m = (await c.post("/api/mission/upload")).json()["data"]
    check("re-upload", m["status"] == "UPLOADED")

    print("\n== 7. Full demo flow: ARM -> START -> 4 WP -> COMPLETED ==")
    await c.put("/api/config", json={"mock_cruise_speed_mps": 9.0})
    r = (await c.post("/api/vehicle/arm")).json()
    check("ARM", r["ok"])
    v = (await c.get("/api/vehicle/state")).json()["data"]
    check("state ARMED immediately after ACK", v["armed"] and v["state"] == "ARMED", v["state"])
    m = (await c.post("/api/mission/start")).json()["data"]
    check("START -> RUNNING", m["status"] == "RUNNING" and m["current_waypoint"] == 1)
    bad = (await c.request("DELETE", f"/api/mission/waypoints/{ids[0]}")).json()
    check("edit blocked while RUNNING", bad["error"]["code"] == "MISSION_ACTIVE")
    bad = (await c.post("/api/vehicle/arm")).json()
    check("ARM blocked while RUNNING", bad["ok"] is False)
    m = (await c.post("/api/mission/pause")).json()["data"]
    check("PAUSE", m["status"] == "PAUSED")
    v1 = (await c.get("/api/vehicle/state")).json()["data"]
    await asyncio.sleep(1.5)
    v2 = (await c.get("/api/vehicle/state")).json()["data"]
    check("vehicle holds position while PAUSED", hav([v1["latitude"], v1["longitude"]], [v2["latitude"], v2["longitude"]]) < 3 and v2["state"] == "PAUSED")
    m = (await c.post("/api/mission/resume")).json()["data"]
    check("RESUME", m["status"] == "RUNNING")

    # theo dõi qua WebSocket tới khi COMPLETED
    ws2 = await websockets.connect(f"{WS}?token={tok}")
    snap = json.loads(await ws2.recv())["data"]
    headings, speeds, batteries, positions, progress, wps_seen = [], [], [], [], [], set()
    sensor_ts = []
    final = None
    t0 = time.time()
    while time.time() - t0 < 180:
        msg = json.loads(await asyncio.wait_for(ws2.recv(), 10))
        if msg["type"] == "vehicle":
            d = msg["data"]
            headings.append(d["heading"]); speeds.append(d["speed"]); batteries.append(d["battery"])
            positions.append([d["latitude"], d["longitude"]])
        elif msg["type"] == "telemetry":
            sensor_ts.append(msg["data"]["timestamp"])
        elif msg["type"] == "mission":
            d = msg["data"]
            progress.append(d["progress"]); wps_seen.add(d["current_waypoint"])
            if d["status"] in ("COMPLETED", "STOPPED", "ERROR"):
                final = d
                break
    await ws2.close()
    check("mission COMPLETED", final is not None and final["status"] == "COMPLETED", f"{(time.time()-t0):.0f}s, completed={final and final['completed']}")
    check("vehicle visited every waypoint (1..4)", wps_seen >= {1, 2, 3, 4}, str(sorted(wps_seen)))
    check("progress increases monotonically to 1.0", progress and progress[-1] >= 0.99 and all(b >= a - 1e-6 for a, b in zip(progress, progress[1:])), f"{len(progress)} updates")
    check("heading changes along route", len(set(round(h) for h in headings)) > 8, f"{len(set(round(h) for h in headings))} distinct headings")
    await asyncio.sleep(1.0)  # chờ packet telemetry sau khi dừng
    v_end = (await c.get("/api/vehicle/state")).json()["data"]
    check("speed changes (>0 while moving, 0 at end)", max(speeds) > 10 and v_end["speed"] < 1, f"max {max(speeds):.1f} km/h, end {v_end['speed']}")
    check("battery decreases", batteries[0] > batteries[-1], f"{batteries[0]:.1f}% -> {batteries[-1]:.1f}%")
    dist = sum(hav(a, b) for a, b in zip(positions, positions[1:]))
    check("vehicle actually moved (trajectory)", dist > 150, f"{dist:.0f} m over {len(positions)} fixes")
    check("sensor telemetry flowing (~1 Hz)", len(sensor_ts) >= 10 and sensor_ts[-1] > sensor_ts[0])
    track = (await c.get("/api/track")).json()["data"]
    check("actual track stored on server", len(track) > 30, f"{len(track)} points")
    v = (await c.get("/api/vehicle/state")).json()["data"]
    check("vehicle back to ARMED after completion", v["state"] == "ARMED" and v["armed"])

    print("\n== 8. History / events ==")
    hist = (await c.get("/api/mission/history")).json()["data"]
    check("history entry saved", hist and hist[0]["status"] == "COMPLETED" and hist[0]["waypoints_completed"] == 4 and hist[0]["name"] == "QA square",
          f"dur={hist[0]['duration_s']}s dist={hist[0]['distance_m']}m batt {hist[0]['battery_start']}->{hist[0]['battery_end']} track={len(hist[0]['track'])}")
    ev = (await c.get("/api/events?limit=100")).json()["data"]
    msgs = [e["message"] for e in ev]
    check("event log has mission lifecycle", any("started" in x for x in msgs) and any("completed" in x for x in msgs) and any("Reached waypoint 4/4" in x for x in msgs), f"{len(ev)} events")
    check("event log has vehicle ARM/state changes", any("ARM" in x for x in msgs) and any("→" in x for x in msgs))
    check("event persisted to file", os.path.exists(os.path.join(os.path.dirname(__file__), "..", "data", "events.jsonl")) or BASE != "http://127.0.0.1:8000")

    print("\n== 9. STOP / ABORT / DISARM / RTL ==")
    await c.post("/api/mission/upload")
    m = (await c.post("/api/mission/start")).json()["data"]
    await asyncio.sleep(1.0)
    m = (await c.post("/api/mission/stop")).json()["data"]
    check("STOP -> STOPPED", m["status"] == "STOPPED")
    await c.post("/api/mission/upload")
    await c.post("/api/mission/start")
    await asyncio.sleep(0.5)
    m = (await c.post("/api/mission/abort")).json()["data"]
    check("ABORT -> STOPPED", m["status"] == "STOPPED")
    hist = (await c.get("/api/mission/history")).json()["data"]
    check("stopped missions recorded in history", len(hist) >= 3 and hist[0]["status"] == "STOPPED", f"{len(hist)} entries")
    await c.post("/api/mission/upload")
    await c.post("/api/mission/start")
    await asyncio.sleep(0.5)
    r = (await c.post("/api/vehicle/disarm")).json()
    v = (await c.get("/api/vehicle/state")).json()["data"]
    m = (await c.get("/api/mission")).json()["data"]
    check("DISARM while RUNNING stops mission safely", r["ok"] and not v["armed"] and v["state"] == "DISARMED" and m["status"] == "STOPPED")
    bad = (await c.post("/api/vehicle/rtl")).json()
    check("RTL blocked when DISARMED", bad["error"]["code"] == "NOT_ARMED")
    await c.post("/api/vehicle/arm")
    r = (await c.post("/api/vehicle/rtl")).json()
    await asyncio.sleep(0.3)
    v = (await c.get("/api/vehicle/state")).json()["data"]
    check("RTL command accepted -> state RTL", r["ok"] and v["state"] == "RTL")
    await asyncio.sleep(20)
    v = (await c.get("/api/vehicle/state")).json()["data"]
    check("RTL arrives home -> ARMED", v["state"] == "ARMED" and hav([v["latitude"], v["longitude"]], [v["home_latitude"], v["home_longitude"]]) < 6,
          f"{hav([v['latitude'], v['longitude']], [v['home_latitude'], v['home_longitude']]):.1f} m from home")

    print("\n== 10. Alerts ==")
    cur = (await c.get("/api/vehicle/state")).json()["data"]["battery"]
    await c.put("/api/config", json={"battery_warn_pct": min(99, cur + 5), "battery_critical_pct": 1})
    await asyncio.sleep(0.6)
    al = (await c.get("/api/alerts?active=true")).json()["data"]
    batt = [a for a in al if a["key"] == "battery"]
    check("low-battery alert raised", batt and batt[0]["level"] == "warning", batt[0]["message"] if batt else "none")
    r = (await c.post(f"/api/alerts/{batt[0]['id']}/ack")).json()["data"] if batt else {"acknowledged": False}
    check("alert acknowledge", r["acknowledged"] is True)
    await c.put("/api/config", json={"battery_warn_pct": 30, "battery_critical_pct": 15})
    await asyncio.sleep(0.6)
    al = (await c.get("/api/alerts?active=true")).json()["data"]
    check("alert auto-clears when condition resolves", not any(a["key"] == "battery" for a in al))
    await c.put("/api/config", json={"geofence_radius_m": 5})
    await asyncio.sleep(0.6)
    al = (await c.get("/api/alerts?active=true")).json()["data"]
    check("geofence alert", any(a["key"] == "geofence" for a in al) or hav([v["latitude"], v["longitude"]], [v["home_latitude"], v["home_longitude"]]) < 5)
    await c.put("/api/config", json={"geofence_radius_m": 1500})

    print("\n== 11. Settings persistence ==")
    r = (await c.put("/api/config", json={"vehicle_name": "QA-ROVER", "mock_cruise_speed_mps": 6.0, "server_port": 9999})).json()["data"]
    check("settings update applied (locked key ignored)", r["settings"]["vehicle_name"] == "QA-ROVER" and r["settings"]["server_port"] != 9999)
    with open(os.path.join(os.path.dirname(__file__), "..", "data", "settings.json"), encoding="utf-8") as fh:
        persisted = json.load(fh)
    check("settings persisted to data/settings.json", persisted.get("vehicle_name") == "QA-ROVER")
    bad = (await c.put("/api/config", json={"battery_warn_pct": "abc"})).json()
    check("invalid setting rejected", bad["error"]["code"] == "INVALID_SETTING")
    sysinfo = (await c.get("/api/config/system")).json()["data"]
    check("system info", sysinfo["version"] and sysinfo["uptime_s"] > 0 and sysinfo["server_port"] == 8000)
    await c.put("/api/config", json={"vehicle_name": "DHMR-32000"})

    print("\n== 12. Disconnect / reconnect data source, logout ==")
    conn = (await c.post("/api/vehicle/disconnect")).json()["data"]
    check("disconnect source", conn["connected"] is False and conn["source"] == "none")
    bad = (await c.post("/api/vehicle/arm")).json()
    check("commands rejected when disconnected", bad["error"]["code"] == "NOT_CONNECTED")
    conn = (await c.post("/api/vehicle/connect", json={"source": "mock"})).json()["data"]
    check("reconnect mock", conn["connected"] and conn["label"] == "MOCK ● ACTIVE")
    bad = (await c.post("/api/vehicle/connect", json={"source": "uart", "port": "/dev/ttyDOESNOTEXIST"})).json()
    conn = (await c.get("/api/vehicle/connection")).json()["data"]
    check("uart with missing port: server survives, label DISCONNECTED", conn["source"] == "uart" and conn["label"] == "UART ● DISCONNECTED", conn["detail"][:60])
    conn = (await c.post("/api/vehicle/connect", json={"source": "mock"})).json()["data"]
    check("back to mock", conn["label"] == "MOCK ● ACTIVE")
    r = (await c.post("/api/auth/logout")).json()
    bad = (await c.get("/api/auth/me")).json()
    check("logout invalidates token", r["ok"] and bad["error"]["code"] == "UNAUTHORIZED")

    await c.aclose()
    failed = [r for r in RESULTS if not r[1]]
    print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} checks passed")
    for name, _, detail in failed:
        print(f"  FAILED: {name} {detail}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
