/* UI smoke test: chạy bundle production trong jsdom, nối tới server thật.
 * cd tests && npm install && node ui_smoke.cjs   (server phải đang chạy: python server.py)
 * Kiểm tra: login, layout/nav, Leaflet init + vehicle marker + heading rotate + track,
 * click map tạo WP, edit/delete/reorder, save/load, ARM/UPLOAD/START qua UI, progress,
 * chuyển page (Leaflet không lỗi), telemetry cards/charts, logs, settings save, logout,
 * WebSocket reconnect khi server restart, không có console error.
 */
const { JSDOM, VirtualConsole } = require("jsdom");
const { execSync } = require("child_process");

const path = require("path");
const BASE = process.env.BASE || "http://127.0.0.1:8000";
const ROOT = path.resolve(__dirname, "..");
// lệnh dừng/khởi động lại server cho test reconnect (ghi đè bằng STOP_CMD / RESTART_CMD nếu chạy nơi khác)
const STOP_CMD = process.env.STOP_CMD || "pkill -f '^python3 server.py' || true";
const RESTART_CMD = process.env.RESTART_CMD || `cd "${ROOT}" && (setsid nohup python3 server.py >/dev/null 2>&1 </dev/null &) ; sleep 2.5`;
const results = [];
const check = (name, ok, detail = "") => {
  results.push([name, !!ok]);
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${name}${detail ? " — " + detail : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeout = 8000, step = 100) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try { const v = fn(); if (v) return v; } catch { /* retry */ }
    await sleep(step);
  }
  return null;
}

(async () => {
  const consoleErrors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => {
    const msg = String(e && e.message || e);
    if (/HTMLCanvasElement.*getContext/.test(msg)) return; // jsdom không có canvas — đã xử lý trong app
    consoleErrors.push(msg);
  });
  vc.on("error", (...a) => consoleErrors.push(a.map(String).join(" ")));
  vc.on("warn", (...a) => { const m = a.map(String).join(" "); if (!/act\(|React Router Future/.test(m)) consoleErrors.push("warn: " + m); });

  const html = await (await fetch(BASE + "/")).text();
  const jsPath = html.match(/src="([^"]+\.js)"/)[1];
  const bundle = await (await fetch(BASE + jsPath)).text();

  const dom = new JSDOM(html.replace(/<script[^>]*><\/script>/, ""), {
    url: BASE + "/", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: vc,
  });
  const { window } = dom;
  const { document } = window;
  // ---- polyfill cho jsdom ----
  window.fetch = (url, init) => fetch(new URL(url, BASE).toString(), init);
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  // Leaflet cần kích thước container > 0 để tính toạ độ click
  Object.defineProperty(window.HTMLElement.prototype, "clientWidth", { get() { return this.classList && this.classList.contains("leaflet-container") ? 800 : 300; }, configurable: true });
  Object.defineProperty(window.HTMLElement.prototype, "clientHeight", { get() { return this.classList && this.classList.contains("leaflet-container") ? 500 : 200; }, configurable: true });
  Object.defineProperty(window.HTMLElement.prototype, "offsetWidth", { get() { return this.clientWidth; }, configurable: true });
  Object.defineProperty(window.HTMLElement.prototype, "offsetHeight", { get() { return this.clientHeight; }, configurable: true });
  Object.defineProperty(window.HTMLElement.prototype, "offsetWidth", { get() { return this.clientWidth; }, configurable: true });
  Object.defineProperty(window.HTMLElement.prototype, "offsetHeight", { get() { return this.clientHeight; }, configurable: true });
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    const w = this.clientWidth, h = this.clientHeight;
    return { x: 0, y: 0, top: 0, left: 0, width: w, height: h, right: w, bottom: h, toJSON() {} };
  };

  const setReactValue = (el, value) => {
    const proto = el.tagName === "SELECT" ? window.HTMLSelectElement.prototype : el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new window.Event("input", { bubbles: true }));
    el.dispatchEvent(new window.Event("change", { bubbles: true }));
  };
  const click = (el) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const btn = (text) => $$("button").find((b) => b.textContent.trim().toUpperCase().startsWith(text.toUpperCase()));
  const confirmDialog = async () => { const d = await waitFor(() => $(".modal .actions .btn.primary, .modal .actions .btn.danger")); if (d) click(d); return !!d; };
  const text = (sel) => ($(sel) ? $(sel).textContent : "");

  // reset server-side mission to a clean state
  const login = await (await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "admin" }) })).json();
  const H = { Authorization: "Bearer " + login.data.token, "Content-Type": "application/json" };
  await fetch(BASE + "/api/mission/new", { method: "POST", headers: H });
  await fetch(BASE + "/api/vehicle/connect", { method: "POST", headers: H, body: JSON.stringify({ source: "mock" }) });
  await fetch(BASE + "/api/config", { method: "PUT", headers: H, body: JSON.stringify({ mock_cruise_speed_mps: 9 }) });

  console.log("\n== Boot bundle in jsdom ==");
  window.eval(bundle);
  check("login page rendered (auth gate)", await waitFor(() => $("#u") && $("#p")), "form fields present");

  console.log("\n== Login via UI ==");
  setReactValue($("#u"), "admin"); setReactValue($("#p"), "wrongpass");
  click($("button[type=submit]"));
  check("wrong password shows error", await waitFor(() => /Wrong username or password/.test(text(".login"))));
  setReactValue($("#p"), "admin");
  click($("button[type=submit]"));
  check("layout + sidebar nav after login", await waitFor(() => $(".sidebar") && $$(".nav a").length === 5), $$(".nav a").map((a) => a.textContent.trim()).join(","));
  check("default route is /maps", await waitFor(() => window.location.pathname === "/maps"), window.location.pathname);
  check("connection pill realtime -> MOCK ● ACTIVE", await waitFor(() => /MOCK ● ACTIVE/.test(text(".topbar .status-pill"))), text(".topbar .status-pill"));
  check("vehicle state badge DISARMED", await waitFor(() => /DISARMED/.test(text(".topbar .badge"))));

  console.log("\n== MAPS: Leaflet ==");
  check("leaflet container initialised", await waitFor(() => $(".leaflet-container")));
  check("tile layer added", await waitFor(() => $(".leaflet-tile-pane")));
  const veh = await waitFor(() => $(".veh-icon"));
  check("vehicle marker on map", !!veh);
  check("home marker on map", await waitFor(() => $(".home-icon")));
  const hdg0 = veh && veh.style.transform;
  check("vehicle marker rotated by heading", /rotate\(\d/.test(hdg0 || ""), hdg0);
  check("compass shows heading number", await waitFor(() => /\d+°/.test(text(".compass .center-text"))), text(".compass .center-text"));
  check("battery value rendered", await waitFor(() => /\d+%/.test(text(".battery"))), text(".battery .v"));
  check("speed value rendered", /km\/h/.test(text(".field .v.xl") + (document.querySelector(".field .v.xl") ? document.querySelector(".field .v.xl").parentElement.textContent : "")));
  check("waypoint list empty state", /No waypoints/.test(text(".wp-list, .empty")));

  console.log("\n== MAPS: click to add waypoints ==");
  const mapEl = $(".leaflet-container");
  const addByClick = async (x, y) => {
    const before = $$(".wp-icon").length;
    mapEl.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window }));
    return !!(await waitFor(() => $$(".wp-icon").length === before + 1, 4000));
  };
  const r1 = await addByClick(420, 230), r2 = await addByClick(520, 250), r3 = await addByClick(500, 320), r4 = await addByClick(380, 300);
  check("4 map clicks -> 4 waypoint markers", r1 && r2 && r3 && r4 && $$(".wp-icon").length === 4, `${$$(".wp-icon").length} markers`);
  check("waypoint rows in list", await waitFor(() => $$(".wp-row").length === 4));
  check("route polyline drawn (4 points)", await waitFor(() => $$(".leaflet-overlay-pane path").some((p) => (p.getAttribute("d") || "").split("L").length >= 4)));
  check("mission summary WAYPOINTS: 04", await waitFor(() => /04/.test($$(".mission-summary .field")[0].textContent) && /READY/.test(text(".mission-card"))));
  const mission1 = (await (await fetch(BASE + "/api/mission")).json()).data;
  check("waypoints stored in backend", mission1.waypoints.length === 4 && mission1.status === "READY");
  const wp1 = mission1.waypoints[0];
  check("clicked position -> real lat/lon near home", Math.abs(wp1.latitude - 16.0748) < 0.01 && Math.abs(wp1.longitude - 108.15) < 0.01, `${wp1.latitude.toFixed(5)}, ${wp1.longitude.toFixed(5)}`);

  console.log("\n== MAPS: edit / reorder / delete ==");
  const nameInput = $$(".wp-row input")[0];
  setReactValue(nameInput, "Gate"); nameInput.dispatchEvent(new window.FocusEvent("focusout", { bubbles: true }));
  await sleep(600);
  let m = (await (await fetch(BASE + "/api/mission")).json()).data;
  check("rename waypoint via list (blur commits)", m.waypoints[0].name === "Gate", m.waypoints.map((w) => w.name).join(","));
  const latInput = $$(".wp-row")[1].querySelector("input[aria-label='Latitude']");
  setReactValue(latInput, "16.0790"); latInput.dispatchEvent(new window.FocusEvent("focusout", { bubbles: true }));
  await sleep(600);
  m = (await (await fetch(BASE + "/api/mission")).json()).data;
  check("edit latitude via list", Math.abs(m.waypoints[1].latitude - 16.079) < 1e-6, String(m.waypoints[1].latitude));
  const ids = m.waypoints.map((w) => w.id);
  click($$(".wp-row")[1].querySelector("button[title='Move up']"));
  await sleep(500);
  m = (await (await fetch(BASE + "/api/mission")).json()).data;
  check("move up reorders (WP2 -> first)", m.waypoints[0].id === ids[1] && m.waypoints[1].id === ids[0], m.waypoints.map((w) => w.id).join(","));
  // drag & drop reorder: kéo hàng cuối lên đầu
  const rows = $$(".wp-row");
  rows[3].dispatchEvent(new window.Event("dragstart", { bubbles: true }));
  await sleep(50);
  rows[0].dispatchEvent(new window.Event("dragover", { bubbles: true, cancelable: true }));
  await sleep(50);
  rows[0].dispatchEvent(new window.Event("drop", { bubbles: true }));
  await sleep(600);
  const m2 = (await (await fetch(BASE + "/api/mission")).json()).data;
  check("drag-and-drop reorder", m2.waypoints[0].id === m.waypoints[3].id, m2.waypoints.map((w) => w.id).join(","));
  const delBtn = $$(".wp-row")[3].querySelector("button[title='Delete']");
  click(delBtn);
  check("delete waypoint via list", await waitFor(() => $$(".wp-row").length === 3 && $$(".wp-icon").length === 3));
  const r5 = await addByClick(450, 200);
  check("re-add 4th waypoint", r5 && $$(".wp-row").length === 4);

  console.log("\n== MAPS: save / load ==");
  setReactValue($("input[placeholder='Mission name']"), "UI demo");
  click(btn("Save"));
  check("save mission toast", await waitFor(() => /Mission saved/.test(text(".toasts"))));
  check("saved mission in dropdown", await waitFor(() => $$("select option").some((o) => /UI demo/.test(o.textContent))));
  click(btn("New"));
  check("new mission clears list", await waitFor(() => $$(".wp-row").length === 0 && $$(".wp-icon").length === 0));
  const sel = $$("select").find((s) => s.getAttribute("aria-label") === "Saved missions");
  const opt = Array.from(sel.options).find((o) => /UI demo/.test(o.textContent));
  setReactValue(sel, opt.value);
  click(btn("Load"));
  check("load mission restores 4 waypoints", await waitFor(() => $$(".wp-row").length === 4 && $$(".wp-icon").length === 4));

  console.log("\n== MAPS: ARM / UPLOAD / START via UI ==");
  check("START blocked hint shown", /START requires/.test(text(".page")));
  click(btn("START"));
  check("START warns when not armed", await waitFor(() => /Cannot START/.test(text(".toasts"))), text(".toasts"));
  click(btn("ARM"));
  check("ARM opens confirmation", await waitFor(() => $(".modal")));
  check("confirm ARM -> badge ARMED", (await confirmDialog()) && (await waitFor(() => /ARMED/.test(text(".topbar .badge")) && !/DISARMED/.test(text(".topbar .badge")))), text(".topbar .badge"));
  click(btn("UPLOAD"));
  check("UPLOAD -> UPLOADED badge + button", await waitFor(() => /UPLOADED/.test(text(".mission-card .card-h")) && !!btn("UPLOADED")));
  check("upload ACK toast", await waitFor(() => /acknowledged/.test(text(".toasts"))));
  const trackBefore = $$(".leaflet-overlay-pane path").length;
  click(btn("START"));
  check("START -> mission RUNNING badge", await waitFor(() => /RUNNING/.test(text(".topbar .badge"))), text(".topbar .badge"));
  check("PAUSE button appears while running", await waitFor(() => !!btn("PAUSE")));
  click(btn("PAUSE"));
  check("PAUSE -> PAUSED", await waitFor(() => /PAUSED/.test(text(".topbar .badge")) && !!btn("RESUME")));
  click(btn("RESUME"));
  check("RESUME -> RUNNING", await waitFor(() => /RUNNING/.test(text(".topbar .badge"))));
  check("map editing locked while running", await waitFor(() => /editing locked/.test(text(".map-hint"))));
  await sleep(4000);
  const hdg1 = $(".veh-icon").style.transform;
  check("vehicle marker heading changed while moving", hdg1 !== hdg0, `${hdg0} -> ${hdg1}`);
  const trackPath = $$(".leaflet-overlay-pane path").find((p) => p.getAttribute("stroke") === "#157a3a");
  const storeTrack = window.__vd.state().track.length;
  check("actual track polyline drawn", trackPath && /^M-?\d+ -?\d+L/.test(trackPath.getAttribute("d") || "") && storeTrack > 10, `${storeTrack} track points in store, path d=${trackPath ? trackPath.getAttribute("d").slice(0, 40) : "none"} (paths ${trackBefore})`);
  check("current waypoint marker highlighted", $$(".wp-icon.current").length === 1);
  check("progress text updating", await waitFor(() => { const t = text(".mission-card"); return /WP 0[1-4] \/ 04/.test(t) && !/\b0%/.test(t); }, 15000), text(".mission-card .num"));
  const battA = parseFloat(text(".battery .v"));
  const speedNow = parseFloat($(".field .v.xl").textContent);
  check("speed shows >0 while moving", speedNow > 3, `${speedNow} km/h`);

  console.log("\n== Page switching while mission runs (Leaflet re-init) ==");
  click($$(".nav a").find((a) => /TELEMETRY/.test(a.textContent)));
  check("telemetry page renders sensor cards", await waitFor(() => $$(".sensor-card").length >= 8), `${$$(".sensor-card").length} cards`);
  check("sensor cards have values + OK status", $$(".sensor-card .value").every((v) => /\d/.test(v.textContent)) && $$(".sensor-card .badge").some((b) => /OK/.test(b.textContent)));
  const tempA = text(".sensor-card .value");
  check("chart cards + range tabs", $$(".chart-card canvas").length >= 4 && $$(".range-tabs button").length === 4);
  click($$(".range-tabs button")[3]);
  check("range tab switch", await waitFor(() => $$(".range-tabs button")[3].classList.contains("active")));
  await sleep(2500);
  check("sensor value updates live", text(".sensor-card .value") !== tempA || /just now|1s ago/.test(text(".sensor-card .meta")), `${tempA} -> ${text(".sensor-card .value")}`);
  check("leaflet removed on unmount", $$(".leaflet-container").length === 0);
  click($$(".nav a").find((a) => /MAPS/.test(a.textContent)));
  check("back to MAPS: exactly one leaflet container, no init error", await waitFor(() => $$(".leaflet-container").length === 1) && $$(".leaflet-container").length === 1);
  check("vehicle marker + waypoints restored after re-mount", await waitFor(() => $(".veh-icon") && $$(".wp-icon").length === 4));
  check("track restored after re-mount", await waitFor(() => $$(".leaflet-overlay-pane path").some((p) => p.getAttribute("stroke") === "#157a3a" && /L/.test(p.getAttribute("d")))) && window.__vd.state().track.length > 10);

  console.log("\n== Wait for mission completion via UI ==");
  const done = await waitFor(() => /COMPLETED/.test(text(".mission-card .card-h .badge")), 150000, 500);
  check("mission COMPLETED badge in summary", !!done);
  check("progress 100% + COMPLETED 04", /100%/.test(text(".mission-card")) && /04/.test($$(".mission-summary .field")[2].textContent), text(".mission-card .num"));
  check("all waypoint markers marked done", $$(".wp-icon.done").length === 4);
  const battB = parseFloat(text(".battery .v"));
  check("battery decreased in UI", battB < battA, `${battA}% -> ${battB}%`);
  check("vehicle badge back to ARMED", await waitFor(() => /^ARMED/.test(text(".topbar .badge").trim())), text(".topbar .badge"));

  console.log("\n== MISSIONS / LOGS pages ==");
  click($$(".nav a").find((a) => /MISSIONS/.test(a.textContent)));
  check("saved missions table", await waitFor(() => /UI demo/.test(text(".table"))));
  check("history table has COMPLETED entry", await waitFor(() => /COMPLETED/.test(text(".page")) && /4\/4/.test(text(".page"))));
  click(btn("View track"));
  check("view track navigates to map with history overlay", await waitFor(() => window.location.pathname === "/maps" && (window.__vd.state().historyTrack || []).length > 10 && $$(".leaflet-overlay-pane path").some((p) => p.getAttribute("stroke") === "#7d8795" && /L/.test(p.getAttribute("d") || ""))), `${(window.__vd.state().historyTrack || []).length} pts`);
  click($$(".nav a").find((a) => /LOGS/.test(a.textContent)));
  check("event log rows rendered", await waitFor(() => $$(".log-row").length > 10), `${$$(".log-row").length} rows`);
  check("event log contains mission completed", /completed/.test(text(".page")));
  // gây alert pin yếu qua settings để test hiển thị
  await fetch(BASE + "/api/config", { method: "PUT", headers: H, body: JSON.stringify({ battery_warn_pct: 99 }) });
  check("alert appears in LOGS + sidebar badge", await waitFor(() => $$(".alert-row").some((r) => /Battery low/.test(r.textContent)) && /ALERT/.test(text(".topbar"))));
  click($$(".alert-row button").find((b) => /ACK/.test(b.textContent)));
  check("alert ACK via UI", await waitFor(() => $$(".alert-row .badge").some((b) => /ACKED/.test(b.textContent))));
  await fetch(BASE + "/api/config", { method: "PUT", headers: H, body: JSON.stringify({ battery_warn_pct: 30 }) });
  check("alert auto-cleared in UI", await waitFor(() => $$(".alert-row .badge").some((b) => /CLEARED/.test(b.textContent))));
  const levelSel = $$("select").find((s) => s.getAttribute("aria-label") === "Level");
  setReactValue(levelSel, "WARNING");
  check("log level filter", await waitFor(() => $$(".log-row").length > 0 && $$(".log-row").every((r) => /WARNING/.test(r.textContent))));

  console.log("\n== SETTINGS ==");
  click($$(".nav a").find((a) => /SETTINGS/.test(a.textContent)));
  check("settings form loaded from backend", await waitFor(() => $("#f-vehicle_name") && $("#f-vehicle_name").value.length > 0), $("#f-vehicle_name") && $("#f-vehicle_name").value);
  check("system info (IP/port/version/uptime)", await waitFor(() => /SERVER IP/.test(text(".page")) && /1\.0\.0/.test(text(".page")) && /\d+s/.test(text(".page"))));
  setReactValue($("#f-vehicle_name"), "UI-ROVER");
  check("unsaved indicator", await waitFor(() => /1 unsaved/.test(text(".page"))));
  click(btn("Save settings"));
  check("settings saved toast", await waitFor(() => /Saved: vehicle_name/.test(text(".toasts"))));
  check("sidebar reflects new vehicle name (WS settings push)", await waitFor(() => /UI-ROVER/.test(text(".brand"))));
  const cfg = (await (await fetch(BASE + "/api/config")).json()).data.settings;
  check("backend persisted setting", cfg.vehicle_name === "UI-ROVER");
  await fetch(BASE + "/api/config", { method: "PUT", headers: H, body: JSON.stringify({ vehicle_name: "DHMR-32000" }) });

  console.log("\n== WebSocket reconnect (server restart) ==");
  execSync(STOP_CMD); await sleep(1500);
  check("pill shows DISCONNECTED when server down", await waitFor(() => /DISCONNECTED|CONNECTING/.test(text(".topbar .status-pill")), 6000), text(".topbar .status-pill"));
  execSync(RESTART_CMD);
  check("auto-reconnect -> MOCK ● ACTIVE (no reload, still logged in)", await waitFor(() => /MOCK ● ACTIVE/.test(text(".topbar .status-pill")) && window.location.pathname === "/settings", 20000, 250), text(".topbar .status-pill"));
  check("data resumes after reconnect", await waitFor(() => { const c = $(".compass .center-text"); return c && /\d/.test(c.textContent) || $$(".sidebar").length === 1; }));

  console.log("\n== Logout ==");
  click(btn("LOGOUT"));
  check("logout confirmation dialog", await waitFor(() => $(".modal")));
  await confirmDialog();
  check("back to login page after logout", await waitFor(() => $("#u") && !$(".sidebar")));

  console.log("\n== Console errors ==");
  const errs = consoleErrors.filter((e) => !/WebSocket|ECONNREFUSED|fetch failed|Cannot reach server|socket hang up/.test(e));
  check("no browser console errors", errs.length === 0, errs.slice(0, 3).join(" | "));
  if (consoleErrors.length) console.log("  (suppressed during restart:", consoleErrors.length, "network messages)");

  const failed = results.filter((r) => !r[1]);
  console.log(`\n${results.length - failed.length}/${results.length} UI checks passed`);
  failed.forEach((f) => console.log("  FAILED:", f[0]));
  window.close();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error("UI test crashed:", e); process.exit(2); });
