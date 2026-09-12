import { useEffect, useRef, useState } from "react";
import { VehicleMap } from "../components/VehicleMap";
import {
  IconCamera,
  IconMaximize,
  IconMinimize,
  IconSatellite,
  IconSwap,
} from "../components/icons";
import { useStore } from "../hooks/useStore";
import { toast } from "../hooks/useToast";

type PipSize = "sm" | "md" | "lg";
type CameraSource = "sim" | "webcam" | "url";

export function CameraPage() {
  const vehicle = useStore((s) => s.vehicle);
  const telemetry = useStore((s) => s.telemetry);
  const mission = useStore((s) => s.mission);
  const settings = useStore((s) => s.settings);

  // States
  const [source, setSource] = useState<CameraSource>("sim");
  const [streamUrl, setStreamUrl] = useState<string>(() => {
    return localStorage.getItem("vd_camera_url") || "";
  });
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [inputUrl, setInputUrl] = useState(streamUrl);

  // Pop-up Map states
  const [pipVisible, setPipVisible] = useState(true);
  const [pipSize, setPipSize] = useState<PipSize>("md");
  const [swapped, setSwapped] = useState(false); // swapped: true = Map is Main, Camera is PiP

  // Video and Canvas refs & webcam stream
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [webcamStream, setWebcamStream] = useState<MediaStream | null>(null);
  const [webcamTrigger, setWebcamTrigger] = useState(0);

  // Camera stream handling (Webcam)
  useEffect(() => {
    let active = true;

    if (source === "webcam") {
      toast("info", "Đang mở Camera laptop...");

      const startWebcam = async () => {
        if (!navigator?.mediaDevices?.getUserMedia) {
          toast("error", "Trình duyệt không hỗ trợ mở Camera hoặc cần chạy trên localhost / HTTPS");
          setSource("sim");
          return;
        }

        // Tắt luồng cũ nếu có
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
        }

        try {
          let stream: MediaStream;
          try {
            // Thử độ phân giải 1280x720 với camera trước/tích hợp của laptop
            stream = await navigator.mediaDevices.getUserMedia({
              video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: "user",
              },
              audio: false,
            });
          } catch {
            // Dự phòng cho máy tính có webcam không đáp ứng độ phân giải trên
            stream = await navigator.mediaDevices.getUserMedia({
              video: true,
              audio: false,
            });
          }

          if (!active) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }

          streamRef.current = stream;
          setWebcamStream(stream);

          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.play().catch(() => {});
          }

          toast("success", "Đã bật Camera laptop để test");
        } catch (err: any) {
          console.error("Webcam access error:", err);
          let errorMsg = "Không thể mở webcam laptop";
          if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
            errorMsg = "Quyền truy cập Camera bị từ chối. Vui lòng bấm 'Cho phép (Allow)' trên trình duyệt.";
          } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
            errorMsg = "Không tìm thấy camera/webcam nào trên máy tính.";
          } else if (err.name === "NotReadableError" || err.name === "TrackStartError") {
            errorMsg = "Camera đang bị một ứng dụng khác (Zoom, Teams, v.v.) chiếm quyền.";
          } else if (err.message) {
            errorMsg = `Lỗi camera: ${err.message}`;
          }
          toast("error", errorMsg);
          setSource("sim");
        }
      };

      startWebcam();
    } else {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      setWebcamStream(null);
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    }

    return () => {
      active = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      setWebcamStream(null);
    };
  }, [source, webcamTrigger]);

  // Synchronize stream to video element whenever stream changes or view swaps (PiP <-> Main)
  useEffect(() => {
    if (source === "webcam" && videoRef.current && webcamStream) {
      if (videoRef.current.srcObject !== webcamStream) {
        videoRef.current.srcObject = webcamStream;
        videoRef.current.play().catch(() => {});
      }
    }
  }, [source, webcamStream, swapped]);

  // FPV HUD Simulation Renderer on Canvas
  useEffect(() => {
    if (source !== "sim") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    let gridOffset = 0;
    let pitchVal = 0;
    let rollVal = 0;

    const render = () => {
      const w = (canvas.width = canvas.clientWidth || 800);
      const h = (canvas.height = canvas.clientHeight || 450);
      const cx = w / 2;
      const cy = h / 2;

      const speed = vehicle.speed ?? 0;
      const heading = vehicle.heading ?? 0;

      // Subtle dynamic pitch & roll when vehicle moves
      if (speed > 0.1) {
        pitchVal = Math.sin(Date.now() / 600) * 1.5 - (speed > 3 ? 1.0 : 0.5);
        rollVal = Math.cos(Date.now() / 800) * 1.8;
      } else {
        pitchVal = 0;
        rollVal = 0;
      }

      // 1. Sky & Ground Gradient Background
      const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
      bgGrad.addColorStop(0, "#0b1928");
      bgGrad.addColorStop(0.5, "#152538");
      bgGrad.addColorStop(0.51, "#18231d");
      bgGrad.addColorStop(1, "#0d140e");
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      // 2. Animated Ground Grid / Perspective Road
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, cy, w, h - cy);
      ctx.clip();

      ctx.strokeStyle = "rgba(46, 204, 113, 0.15)";
      ctx.lineWidth = 1;

      // Perspective lines converging to center horizon
      for (let x = -w * 0.5; x <= w * 1.5; x += 80) {
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(x, h);
        ctx.stroke();
      }

      // Horizontal lines moving towards viewer with speed
      gridOffset = (gridOffset + Math.max(speed, 0.8) * 0.6) % 40;
      for (let y = cy; y < h; y += 12 + (y - cy) * 0.35) {
        const lineY = y + (gridOffset * (y - cy)) / h;
        if (lineY <= h) {
          ctx.beginPath();
          ctx.moveTo(0, lineY);
          ctx.lineTo(w, lineY);
          ctx.stroke();
        }
      }
      ctx.restore();

      // 3. FPV Artificial Horizon & Attitude Ladder (Rotates with roll and pitch)
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((-rollVal * Math.PI) / 180);
      const pitchOffset = (pitchVal / 90) * (h * 0.35);
      ctx.translate(0, pitchOffset);

      // Central Horizon Line
      ctx.strokeStyle = "#38bdf8";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-120, 0);
      ctx.lineTo(-40, 0);
      ctx.moveTo(40, 0);
      ctx.lineTo(120, 0);
      ctx.stroke();

      // Pitch rungs (+10, +20, -10, -20)
      ctx.strokeStyle = "rgba(56, 189, 248, 0.65)";
      ctx.fillStyle = "rgba(56, 189, 248, 0.85)";
      ctx.font = "10px JetBrains Mono, monospace";
      ctx.textAlign = "center";

      [-20, -10, 10, 20].forEach((deg) => {
        const py = (-deg / 90) * (h * 0.35);
        const rw = deg % 20 === 0 ? 50 : 35;
        ctx.beginPath();
        ctx.moveTo(-rw, py);
        ctx.lineTo(-15, py);
        ctx.moveTo(15, py);
        ctx.lineTo(rw, py);
        ctx.stroke();

        ctx.fillText(`${Math.abs(deg)}`, -rw - 12, py + 3);
        ctx.fillText(`${Math.abs(deg)}`, rw + 12, py + 3);
      });

      ctx.restore();

      // 4. Center Rover Reticle
      ctx.save();
      ctx.strokeStyle = "#22c55e";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(cx - 24, cy);
      ctx.lineTo(cx - 8, cy);
      ctx.moveTo(cx + 8, cy);
      ctx.lineTo(cx + 24, cy);
      ctx.moveTo(cx, cy - 14);
      ctx.lineTo(cx, cy - 6);
      ctx.stroke();

      ctx.strokeStyle = "rgba(34, 197, 94, 0.4)";
      ctx.beginPath();
      ctx.arc(cx, cy, 45, -Math.PI * 0.75, -Math.PI * 0.25);
      ctx.arc(cx, cy, 45, Math.PI * 0.25, Math.PI * 0.75);
      ctx.stroke();
      ctx.restore();

      // 5. Compass Ribbon at Top Center (Only if wide enough, skip if small pop-up)
      if (w >= 450) {
        ctx.save();
        const compW = Math.min(360, w * 0.6);
        const compX = cx - compW / 2;
        const compY = 24;

        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = "#aeb6c2";
        ctx.lineWidth = 1;
        ctx.fillRect(compX, compY - 14, compW, 30);
        ctx.strokeRect(compX, compY - 14, compW, 30);

        ctx.beginPath();
        ctx.rect(compX, compY - 14, compW, 30);
        ctx.clip();

        ctx.font = "10px JetBrains Mono, monospace";
        ctx.textAlign = "center";

        for (let d = -180; d <= 540; d += 5) {
          const diff = d - heading;
          const normalizedDiff = ((((diff + 180) % 360) + 360) % 360) - 180;
          const px = cx + normalizedDiff * 3;

          if (px >= compX - 10 && px <= compX + compW + 10) {
            const isCardinal = d % 90 === 0;
            const isMajor = d % 45 === 0;

            ctx.strokeStyle = isMajor ? "#14181f" : "#94a3b8";
            ctx.beginPath();
            ctx.moveTo(px, compY + (isMajor ? 8 : 4));
            ctx.lineTo(px, compY + 14);
            ctx.stroke();

            if (isCardinal) {
              const label =
                ((d % 360) + 360) % 360 === 0
                  ? "N"
                  : ((d % 360) + 360) % 360 === 90
                  ? "E"
                  : ((d % 360) + 360) % 360 === 180
                  ? "S"
                  : "W";
              ctx.fillStyle = label === "N" ? "#b42318" : "#14181f";
              ctx.font = "bold 11px JetBrains Mono, monospace";
              ctx.fillText(label, px, compY + 2);
            } else if (d % 30 === 0) {
              ctx.fillStyle = "#4d5766";
              ctx.font = "9px JetBrains Mono, monospace";
              const degNorm = ((d % 360) + 360) % 360;
              ctx.fillText(`${degNorm}`, px, compY + 2);
            }
          }
        }

        ctx.restore();
        ctx.save();
        ctx.fillStyle = "#b42318";
        ctx.beginPath();
        ctx.moveTo(cx, compY + 16);
        ctx.lineTo(cx - 5, compY + 23);
        ctx.lineTo(cx + 5, compY + 23);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = "#ffffff";
        ctx.fillRect(cx - 24, compY + 24, 48, 16);
        ctx.strokeStyle = "#aeb6c2";
        ctx.strokeRect(cx - 24, compY + 24, 48, 16);
        ctx.fillStyle = "#14181f";
        ctx.font = "bold 11px JetBrains Mono, monospace";
        ctx.textAlign = "center";
        ctx.fillText(`${Math.round(heading)}°`, cx, compY + 36);
        ctx.restore();
      }

      // 6. Vignette and Scanlines
      ctx.fillStyle = "rgba(0, 0, 0, 0.04)";
      for (let i = 0; i < h; i += 4) {
        ctx.fillRect(0, i, w, 1.5);
      }

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [source, vehicle.heading, vehicle.speed, swapped]);

  // Snapshot capture handler
  const handleSnapshot = () => {
    let dataUrl = "";
    if (source === "webcam" && videoRef.current) {
      const v = videoRef.current;
      const c = document.createElement("canvas");
      c.width = v.videoWidth || 1280;
      c.height = v.videoHeight || 720;
      const x = c.getContext("2d");
      if (x) {
        x.drawImage(v, 0, 0);
        dataUrl = c.toDataURL("image/png");
      }
    } else if (canvasRef.current) {
      dataUrl = canvasRef.current.toDataURL("image/png");
    }

    if (dataUrl) {
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `camera_snapshot_${Date.now()}.png`;
      a.click();
      toast("success", "Đã chụp và tải ảnh chụp màn hình");
    }
  };

  const handleSaveStreamUrl = () => {
    setStreamUrl(inputUrl);
    localStorage.setItem("vd_camera_url", inputUrl);
    setShowUrlInput(false);
    setSource("url");
    toast("success", "Đã lưu đường dẫn camera");
  };

  // Switch size
  const cyclePipSize = () => {
    const order: PipSize[] = ["sm", "md", "lg"];
    const idx = order.indexOf(pipSize);
    const next = order[(idx + 1) % order.length] ?? "md";
    setPipSize(next);
  };

  const speedKmh = ((vehicle.speed ?? 0) * 3.6).toFixed(1);
  const batteryPct = Math.round(vehicle.battery ?? 0);
  const aqiVal = telemetry.aqi ?? 58;

  // The Camera View Element
  const renderCameraView = (isMain: boolean) => (
    <div className={`camera-viewport ${isMain ? "main-view" : "pip-view"}`}>
      {source === "webcam" ? (
        <video
          ref={(el) => {
            videoRef.current = el;
            if (el && webcamStream && el.srcObject !== webcamStream) {
              el.srcObject = webcamStream;
              el.play().catch(() => {});
            }
          }}
          autoPlay
          playsInline
          muted
          className="camera-media"
        />
      ) : source === "url" && streamUrl ? (
        <img
          src={streamUrl}
          alt="Live Camera Feed"
          className="camera-media"
          onError={() => {
            toast("error", "Không thể tải luồng video từ URL. Đang chuyển về giả lập.");
            setSource("sim");
          }}
        />
      ) : (
        <canvas ref={canvasRef} className="camera-media" />
      )}

      {/* Real-time FPV HUD Elements - Only when Camera is Main viewport! In pop-up: pure video without text */}
      {isMain && (
        <div className="camera-hud-overlay">
          <div className="hud-corner top-left">
            <div className="hud-badge live">
              <span className="live-dot" />
              <span>{source === "sim" ? "Car SIM" : source === "webcam" ? "WEBCAM LIVE" : "STREAM"}</span>
            </div>
            <div className="hud-item mono">{settings?.vehicle_name ?? "DHMR-32000"}</div>
            <div className={`hud-badge ${vehicle.armed ? "armed" : "disarmed"}`}>
              {vehicle.armed ? "ARMED" : "DISARMED"} · {vehicle.state}
            </div>
            {mission?.status && (
              <div className="hud-item mono text-ok">
                MISSION: {mission.status} (WP {vehicle.current_waypoint}/{vehicle.total_waypoints || mission.waypoints.length})
              </div>
            )}
          </div>

          <div className="hud-corner top-right">
            <div className="hud-metrics-row">
              <div className="hud-pill ok">
                <span>PIN</span>
                <b>{batteryPct}%</b>
                <small>({(vehicle.voltage ?? 12.6).toFixed(1)}V)</small>
              </div>
              <div className="hud-pill ok">
                <span>GPS</span>
                <b>{vehicle.satellites ?? 12} SAT</b>
              </div>
              <div className="hud-pill info">
                <span>AQI</span>
                <b>{aqiVal.toFixed(0)}</b>
              </div>
            </div>
          </div>

          <div className="hud-corner bottom-left">
            <div className="hud-speed-gauge">
              <span className="speed-val mono">{speedKmh}</span>
              <div className="speed-unit">
                <span>KM/H</span>
                <small className="mono">{(vehicle.speed ?? 0).toFixed(1)} m/s</small>
              </div>
            </div>
            <div className="hud-item mono small">
              ĐÍCH TIẾP: {(mission?.distance_remaining_m ?? 0).toFixed(1)}m · WP #{vehicle.current_waypoint}
            </div>
          </div>

          <div className="hud-corner bottom-right">
            <div className="hud-coords mono">
              <span>LAT: {vehicle.latitude.toFixed(6)}°</span>
              <span>LON: {vehicle.longitude.toFixed(6)}°</span>
              <span>ALT: {(vehicle.altitude ?? 0).toFixed(1)}m</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // The Map View Element: Only show toolbar when Map is Main; in Pop-up mode, toolbar is hidden
  const renderMapView = (isMain: boolean) => (
    <div className={`map-viewport ${isMain ? "main-view" : "pip-view"}`}>
      <VehicleMap
        mission={mission}
        editable={false}
        showToolbar={isMain}
        onMapClick={() => {}}
        onWaypointMoved={() => {}}
      />
    </div>
  );

  return (
    <div className="page camera-page">
      {/* Top Camera Header Toolbar */}
      <div className="camera-header-bar">
        <div className="camera-title-group">
          <IconCamera width={18} height={18} />
          <span className="camera-title">CAMERA</span>
        </div>

        <div className="camera-actions-group">
          <div className="btn-group">
            <button
              className={`btn sm ${source === "sim" ? "primary active" : ""}`}
              onClick={() => setSource("sim")}
              title="Chế độ mô phỏng xe chạy Car SIM trực quan"
            >
              Car SIM
            </button>
            <button
              className={`btn sm ${source === "webcam" ? "primary active" : ""}`}
              onClick={() => {
                if (source === "webcam") {
                  setWebcamTrigger((c) => c + 1);
                } else {
                  setSource("webcam");
                }
              }}
              title="Bật Webcam máy tính laptop / Camera USB để test thực tế"
            >
              Webcam
            </button>
            <button
              className={`btn sm ${source === "url" ? "primary active" : ""}`}
              onClick={() => {
                if (!streamUrl) setShowUrlInput(true);
                else setSource("url");
              }}
              title="Nhập địa chỉ luồng video IP (RTSP / MJPEG / HTTP)"
            >
              Luồng IP
            </button>
          </div>

          <button
            className={`btn sm ${showUrlInput ? "active" : ""}`}
            onClick={() => setShowUrlInput(!showUrlInput)}
            title="Cài đặt địa chỉ URL camera"
          >
            URL...
          </button>

          <button className="btn sm" onClick={handleSnapshot} title="Chụp ảnh màn hình camera">
            <IconCamera width={14} height={14} /> Chụp ảnh
          </button>

          <div className="toolbar-divider" />

          {/* Swap View Button: SWAP MAIN AND PIP */}
          <button
            className={`btn sm ${swapped ? "warn" : ""}`}
            onClick={() => setSwapped(!swapped)}
            title="Đổi góc nhìn: Chuyển Bản đồ thành màn hình chính và Camera vào cửa sổ Pop-up, hoặc ngược lại"
          >
            <IconSwap width={14} height={14} />
            {swapped ? "Xem Camera chính" : "Đổi góc nhìn (Bản đồ chính)"}
          </button>

          {/* Pop-up Map Visibility Toggle */}
          <button
            className={`btn sm ${pipVisible ? "active" : ""}`}
            onClick={() => setPipVisible(!pipVisible)}
            title={pipVisible ? "Ẩn cửa sổ pop-up bản đồ" : "Hiện cửa sổ pop-up bản đồ"}
          >
            <IconSatellite width={14} height={14} />
            <span>{pipVisible ? "Ẩn Pop-up Map" : "Hiện Pop-up Map"}</span>
          </button>
        </div>

        {/* Stream URL floating dropdown (Absolute position: does not push header or jump buttons) */}
        {showUrlInput && (
          <div className="stream-url-bar-popover">
            <span className="label">ĐỊA CHỈ LUỒNG CAMERA (MJPEG / RTSP-HTTP):</span>
            <input
              type="text"
              className="input sm mono grow"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              placeholder="http://192.168.1.100:8080/?action=stream"
              autoFocus
            />
            <button className="btn sm primary" onClick={handleSaveStreamUrl}>
              Lưu & Kết nối
            </button>
            <button className="btn sm" onClick={() => setShowUrlInput(false)}>
              Đóng
            </button>
          </div>
        )}
      </div>

      {/* Main Container */}
      <div className="camera-stage-container">
        <div className="main-viewport-wrapper">
          {swapped ? renderMapView(true) : renderCameraView(true)}

          {pipVisible && (
            <div className={`floating-pip-card pip-${pipSize}`}>
              <div className="pip-header">
                <div className="pip-title">
                  {swapped ? <IconCamera width={14} height={14} /> : <IconSatellite width={14} height={14} />}
                  <span>{swapped ? "CAMERA" : "BẢN ĐỒ XE CHẠY"}</span>
                  {!swapped && <span className="badge ok small mono">{speedKmh} km/h</span>}
                </div>

                <div className="pip-header-actions">
                  <button
                    className="icon-btn xs"
                    onClick={() => setSwapped(!swapped)}
                    title="Đổi góc nhìn (Mở rộng thành màn hình chính)"
                  >
                    <IconSwap width={12} height={12} />
                  </button>

                  <button
                    className="icon-btn xs"
                    onClick={cyclePipSize}
                    title={`Đổi kích thước pop-up (Hiện tại: ${pipSize.toUpperCase()})`}
                  >
                    <IconMaximize width={12} height={12} />
                  </button>

                  <button
                    className="icon-btn xs"
                    onClick={() => setPipVisible(false)}
                    title="Ẩn cửa sổ pop-up"
                  >
                    <IconMinimize width={12} height={12} />
                  </button>
                </div>
              </div>

              <div className="pip-body">
                {swapped ? renderCameraView(false) : renderMapView(false)}
              </div>

              {!swapped && (
                <div className="pip-footer mono">
                  <span>
                    XE: {vehicle.latitude.toFixed(5)}, {vehicle.longitude.toFixed(5)}
                  </span>
                  <span>HDG: {Math.round(vehicle.heading)}°</span>
                </div>
              )}
            </div>
          )}

          {!pipVisible && (
            <button
              className="btn sm pip-reopen-btn"
              onClick={() => setPipVisible(true)}
              title="Mở lại Pop-up Map theo dõi xe"
            >
              <IconSatellite width={14} height={14} /> Hiện Pop-up Map
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

