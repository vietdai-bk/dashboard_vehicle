# Vehicle Dashboard — Ground Control Station (Raspberry Pi)

Web dashboard điều khiển & giám sát phương tiện tự hành, chạy như local server trên
Raspberry Pi, truy cập từ trình duyệt trong LAN/Wi-Fi.

```
STM32 ──UART──▶ UARTTelemetryProvider ─┐
                                        ├─▶ protocol.parse_packet ─▶ VehicleStateStore ─▶ REST + WebSocket ─▶ React dashboard
Mock engine ──▶ MockTelemetryProvider ──┘        (backend/hardware)      (backend/core)
```

Mock và UART implement cùng interface `TelemetryProvider`; frontend không biết dữ liệu
đến từ đâu. Chuyển nguồn bằng `DATA_SOURCE=mock|uart` trong `.env` hoặc trang SETTINGS.

## 1. Chạy nhanh (bản zip đã kèm frontend build sẵn — Pi KHÔNG cần Node.js)

```bash
unzip vehicle-dashboard.zip && cd vehicle-dashboard
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # sửa AUTH_PASSWORD, HOME_LAT/LON, UART_PORT nếu cần
python server.py              # hoặc: ./start.sh
```

Mở `http://<ip-cua-pi>:8000/` từ máy khác trong mạng (IP xem ở `hostname -I` hoặc trang
SETTINGS ▸ SYSTEM). Đăng nhập mặc định `admin / admin`.

Cách chạy khác: `uvicorn backend.main:app --host 0.0.0.0 --port 8000` hoặc `python backend/main.py`.

## 2. Cài thành service tự chạy khi boot

```bash
bash deploy/install_pi.sh     # venv + deps + /etc/systemd/system/vehicle-dashboard.service
sudo systemctl status vehicle-dashboard
sudo journalctl -u vehicle-dashboard -f          # xem log
```

Cài tay: `sudo cp deploy/vehicle-dashboard.service /etc/systemd/system/`, sửa `User=` và
đường dẫn, rồi `sudo systemctl daemon-reload && sudo systemctl enable --now vehicle-dashboard`.

## 3. Build lại frontend (chỉ khi sửa code React)

```bash
cd frontend
npm install
npm run build        # tsc --noEmit (strict) + vite build → frontend/dist (backend phục vụ trực tiếp)
npm run dev          # dev server :5173, proxy /api và /ws sang :8000
```

## 4. Kiểm thử

```bash
python server.py &                       # server phải đang chạy
python tests/test_flow.py                # 74 check: REST/WS/state machine/full mission flow/alerts/settings
node tests/ui_smoke.cjs                  # 82 check UI trong jsdom (cần: npm i jsdom ws ở thư mục khác, NODE_PATH=...)
```

## 5. Cấu trúc

```
server.py                       entry: python server.py
backend/
  main.py                       FastAPI app, WebSocket /ws/telemetry, serve frontend/dist (SPA)
  config.py                     Settings từ .env + data/settings.json (đổi được từ UI)
  models.py                     Pydantic models (VehicleState, Telemetry, Waypoint, Mission, …)
  api/  auth.py vehicle.py mission.py telemetry.py config.py   REST, response {ok,data,error}
  core/ state.py                VehicleStateStore: nhận packet, state machine, track, alerts, watchdog
        websocket.py            ConnectionManager broadcast (thread-safe)
        events.py               EventLog (data/events.jsonl) + AlertManager
        auth.py                 username/password từ .env, token (data/tokens.json)
  hardware/ protocol.py         JSON-line protocol STM32⇄Pi: parse/validate/encode
            uart.py             UARTTelemetryProvider (PySerial, thread, reconnect, ACK)
  telemetry/ provider.py        interface TelemetryProvider
             mock.py            MockTelemetryProvider: vehicle giả lập chạy qua waypoint
  mission/ manager.py           waypoint CRUD, upload/start/stop/pause/resume/abort, saved missions, history
frontend/src/
  pages/ Maps Telemetry Missions Logs Settings Login
  components/ VehicleMap(Leaflet) ControlPanel WaypointList MissionSummary VehicleStatusPanel Compass BatteryGauge LineChart …
  services/ api.ts ws.ts(auto-reconnect) auth.ts   stores/store.ts   hooks/
data/                           settings.json, missions.json, history.json, events.jsonl, tokens.json (tự tạo)
deploy/                         vehicle-dashboard.service, install_pi.sh
tests/                          test_flow.py (E2E), ui_smoke.cjs (UI)
```

## 6. REST API (tất cả trả `{"ok": bool, "data": …, "error": {"code","message"}|null}`)

| Method | Path | Ghi chú |
|---|---|---|
| POST | /api/auth/login, /logout · GET /api/auth/me, /status | token Bearer, hoặc `?token=` cho WS |
| GET | /api/vehicle/state, /connection | |
| POST | /api/vehicle/arm, /disarm, /rtl, /command | /command: `{"command":"ARM"}` (chỉ lệnh trong protocol) |
| POST | /api/vehicle/connect `{source,port,baudrate}`, /disconnect | đổi mock/uart lúc chạy |
| GET/DELETE | /api/mission | mission hiện tại / xoá waypoint |
| POST | /api/mission/waypoints · PUT/DELETE /api/mission/waypoints/{id} · PUT /waypoints/reorder | sửa khi mission đang chạy → 409 MISSION_ACTIVE |
| POST | /api/mission/upload, /start, /stop, /pause, /resume, /abort, /new · PUT /name | START yêu cầu ARMED + UPLOADED |
| GET/POST | /api/mission/saved · POST /saved/{id}/load · DELETE /saved/{id} | lưu/tải mission |
| GET/DELETE | /api/mission/history | lịch sử chuyến (kèm track) |
| GET | /api/telemetry, /telemetry/history?seconds=, /track, /events, /alerts · POST /alerts/{id}/ack | |
| GET/PUT | /api/config · GET /api/config/system | settings (khoá server/auth không đổi qua API) |
| WS | /ws/telemetry?token= | `snapshot` rồi `vehicle`(5 Hz) `telemetry`(1 Hz) `mission` `connection` `event` `alert` `history` `settings` |

## 7. State machine

Vehicle: `DISARMED → ARMED → RUNNING ⇄ PAUSED → STOPPED/COMPLETED → ARMED`, `RTL`, `ERROR`.
Mission: `EMPTY → READY → UPLOADING → UPLOADED → RUNNING ⇄ PAUSED → COMPLETED | STOPPED`, `ERROR`.
Chặn: START khi DISARMED / chưa upload / mission rỗng; UPLOAD mission rỗng; sửa waypoint khi
RUNNING; ARM khi RUNNING; DISARM khi RUNNING → tự STOP mission trước.
Mọi lệnh đi qua ACK của vehicle; backend cập nhật state ngay khi có ACK (không chờ packet kế).

## 8. Protocol UART (STM32 ⇄ Pi) — mỗi packet 1 dòng JSON + `\n`

STM32 → Pi:
```json
{"type":"telemetry","lat":16.0544,"lon":108.2022,"heading":127.4,"speed":12.2,"battery":82,"voltage":12.1,"altitude":0,"satellites":11,"armed":true,"state":"RUNNING","current_waypoint":2,"total_waypoints":5,"distance_travelled":143.2,"home_lat":16.05,"home_lon":108.20}
{"type":"sensor","temperature":28.4,"humidity":71.2,"pressure":1012.3,"co2":640,"pm25":18,"pm10":27,"light":820,"gas":120,"imu_roll":1.2,"imu_pitch":-0.4,"imu_yaw":127.4}
{"type":"mission","state":"RUNNING","current_waypoint":2,"completed":1,"total":5,"distance_remaining":123.4}
{"type":"ack","command":"ARM","ok":true,"message":"armed"}
{"type":"log","level":"INFO","message":"Reached waypoint 2/5"}
{"type":"heartbeat"}
```
Pi → STM32:
```json
{"command":"ARM"}  {"command":"DISARM"}  {"command":"START"}  {"command":"STOP"}  {"command":"PAUSE"}  {"command":"RESUME"}  {"command":"RTL"}
{"command":"UPLOAD_MISSION","waypoints":[{"id":1,"lat":16.0544,"lon":108.2022,"alt":0},{"id":2,"lat":16.0550,"lon":108.2030,"alt":0}]}
```
Quy tắc: `speed` km/h; `heading` 0–360; `battery` 0–100; `state` ∈ DISARMED/ARMED/RUNNING/PAUSED/STOPPED/RTL/ERROR;
`mission.state` ∈ RUNNING/PAUSED/COMPLETED/STOPPED. STM32 phải trả `ack` cho mỗi lệnh trong 2 s.
Packet sai JSON / ngoài dải → log `[ERROR] Invalid telemetry packet`, bỏ qua, không crash.
Không có packet trong `UART_TIMEOUT` s → `UART ● DISCONNECTED` + alert `Link lost`.

## 9. Chuyển từ Mock sang STM32 thật

Đã sẵn sàng (không cần sửa frontend):
- `DATA_SOURCE=uart`, `UART_PORT`, `UART_BAUDRATE` trong `.env` hoặc SETTINGS ▸ Apply & reconnect.
- `backend/hardware/uart.py`: mở cổng, thread đọc dòng, parse/validate, auto-reconnect, timeout, gửi lệnh + chờ ACK.
- `backend/hardware/protocol.py`: định dạng đã chốt ở mục 8; mock phát đúng định dạng này nên toàn bộ pipeline phía sau đã được kiểm thử với dữ liệu "thật".
- State machine, alerts (battery/geofence/link), history, logs hoạt động độc lập nguồn dữ liệu.

Cần làm khi nối hardware:
1. Firmware STM32 phát `telemetry` ≥ 2 Hz, `sensor` ~1 Hz, `mission` khi chạy, `heartbeat` 0.5 Hz; trả `ack` cho mọi lệnh.
2. STM32 tự thực thi mission (điều hướng qua waypoint sau `START`) và báo `mission.state=COMPLETED` khi xong — backend chỉ giám sát, không điều khiển vòng kín.
3. Trên Pi: `sudo usermod -aG dialout $USER`, kiểm tra `/dev/ttyUSB0` hoặc `/dev/serial0` (bật UART trong `raspi-config`, tắt serial console).
4. Kiểm tra bằng `python -m serial.tools.miniterm /dev/ttyUSB0 115200` rồi bật `LOG_LEVEL=DEBUG` để xem packet.
5. Nếu cần thêm sensor: thêm trường vào `backend/models.py: Telemetry`, dải hợp lệ trong `protocol._SENSOR_RANGES`, và một dòng trong `frontend/src/types.ts: SENSORS`.
6. Tuỳ chọn: checksum/CRC cho packet, cơ chế `seq` chống mất gói, nhị phân hoá nếu băng thông UART hạn chế.

## 10. Vận hành offline
Bản đồ dùng tile OpenStreetMap qua Internet. Chạy hoàn toàn offline: dựng tile server nội bộ
(ví dụ `tileserver-gl` hoặc thư mục tile tĩnh) rồi đổi `MAP_TILES` thành `http://<pi>:8080/{z}/{x}/{y}.png`.
Mọi thứ khác (fonts, JS, CSS, Leaflet) đã đóng gói trong `frontend/dist`, không gọi CDN.

## 11. Bảo mật
Đổi `AUTH_PASSWORD` trước khi triển khai. Token lưu băm SHA-256 trong `data/tokens.json`, hết hạn 12 h.
Thiết kế cho phép thay `core/auth.py` bằng JWT/session/DB mà không đổi API (`/api/auth/*`).
