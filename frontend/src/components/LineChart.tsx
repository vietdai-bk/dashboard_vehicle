import { useEffect, useRef } from "react";

export interface Series {
  label: string;
  color: string;
  points: { t: number; v: number }[];
}

interface Props {
  series: Series[];
  windowS: number;      // độ rộng trục thời gian (giây)
  unit?: string;
  height?: number;
  sparkline?: boolean;  // chế độ mini: không trục, không nhãn
}

/** Biểu đồ đường canvas nhẹ, không phụ thuộc thư viện. Vẽ lại mỗi khi dữ liệu đổi. */
export function LineChart({ series, windowS, unit = "", height = 200, sparkline = false }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 300;
    const h = canvas.clientHeight || height;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const style = getComputedStyle(document.documentElement);
    const lineColor = style.getPropertyValue("--line").trim() || "#ddd";
    const textColor = style.getPropertyValue("--text-3").trim() || "#888";
    const padL = sparkline ? 0 : 44, padR = sparkline ? 0 : 8, padT = sparkline ? 2 : 8, padB = sparkline ? 2 : 18;
    const plotW = w - padL - padR, plotH = h - padT - padB;

    const now = Math.max(...series.flatMap((s) => s.points.map((p) => p.t)), Date.now() / 1000);
    const tMin = now - windowS;
    const visible = series.map((s) => ({ ...s, points: s.points.filter((p) => p.t >= tMin) }));
    let vMin = Infinity, vMax = -Infinity;
    visible.forEach((s) => s.points.forEach((p) => { vMin = Math.min(vMin, p.v); vMax = Math.max(vMax, p.v); }));
    if (!isFinite(vMin)) { vMin = 0; vMax = 1; }
    if (vMax - vMin < 1e-6) { vMin -= 1; vMax += 1; }
    const pad = (vMax - vMin) * 0.12;
    vMin -= pad; vMax += pad;

    const x = (t: number) => padL + ((t - tMin) / windowS) * plotW;
    const y = (v: number) => padT + (1 - (v - vMin) / (vMax - vMin)) * plotH;

    if (!sparkline) {
      ctx.strokeStyle = lineColor; ctx.lineWidth = 1; ctx.fillStyle = textColor;
      ctx.font = "10px " + (style.getPropertyValue("--mono").trim() || "monospace");
      const rows = 4;
      for (let i = 0; i <= rows; i++) {
        const v = vMin + ((vMax - vMin) * i) / rows;
        const yy = y(v);
        ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(w - padR, yy); ctx.stroke();
        ctx.textAlign = "right"; ctx.textBaseline = "middle";
        ctx.fillText(v.toFixed(Math.abs(vMax - vMin) < 10 ? 1 : 0), padL - 4, yy);
      }
      const cols = 4;
      ctx.textBaseline = "top"; ctx.textAlign = "center";
      for (let i = 0; i <= cols; i++) {
        const t = tMin + (windowS * i) / cols;
        const xx = x(t);
        ctx.beginPath(); ctx.moveTo(xx, padT); ctx.lineTo(xx, padT + plotH); ctx.stroke();
        const ago = Math.round(now - t);
        ctx.fillText(ago === 0 ? "now" : ago >= 60 ? `-${Math.round(ago / 60)}m` : `-${ago}s`, Math.min(w - 14, Math.max(padL + 10, xx)), padT + plotH + 4);
      }
      if (unit) { ctx.textAlign = "left"; ctx.fillText(unit, padL + 4, padT + 2); }
    }

    visible.forEach((s) => {
      if (s.points.length < 2) return;
      ctx.strokeStyle = s.color; ctx.lineWidth = sparkline ? 1.5 : 1.8; ctx.lineJoin = "round";
      ctx.beginPath();
      s.points.forEach((p, i) => (i ? ctx.lineTo(x(p.t), y(p.v)) : ctx.moveTo(x(p.t), y(p.v))));
      ctx.stroke();
      if (sparkline) {
        const last = s.points[s.points.length - 1]!;
        ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(x(last.t), y(last.v), 2, 0, Math.PI * 2); ctx.fill();
      }
    });
  }, [series, windowS, unit, height, sparkline]);

  return <canvas ref={ref} style={{ width: "100%", height }} />;
}
