export function batteryClass(pct: number, warn: number, critical: number): "" | "warn" | "danger" {
  if (pct <= critical) return "danger";
  if (pct <= warn) return "warn";
  return "";
}

export function BatteryGauge({ pct, warn = 30, critical = 15, voltage }: { pct: number; warn?: number; critical?: number; voltage?: number }) {
  const cls = batteryClass(pct, warn, critical);
  return (
    <div className={`battery ${cls}`}>
      <span className="battery-icon"><i style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></span>
      <div className="grow">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="v num" style={{ fontSize: 20, fontWeight: 600 }}>{pct.toFixed(0)}%</span>
          {voltage !== undefined && <span className="muted num small">{voltage.toFixed(2)} V</span>}
        </div>
        <div className={`progress ${cls === "" ? "ok" : cls}`}><i style={{ width: `${pct}%` }} /></div>
      </div>
    </div>
  );
}
