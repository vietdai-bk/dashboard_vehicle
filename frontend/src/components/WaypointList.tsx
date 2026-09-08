import { useState } from "react";
import type { Mission, Waypoint } from "../types";
import { IconDown, IconUp, IconX } from "./icons";

interface Props {
  mission: Mission | null;
  editable: boolean;
  onUpdate: (id: number, patch: Partial<Pick<Waypoint, "latitude" | "longitude" | "altitude" | "name">>) => void;
  onDelete: (id: number) => void;
  onReorder: (ids: number[]) => void;
}

/** Danh sách waypoint: sửa toạ độ inline, xoá, đổi thứ tự bằng nút hoặc kéo thả. */
export function WaypointList({ mission, editable, onUpdate, onDelete, onReorder }: Props) {
  const wps = mission?.waypoints ?? [];
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const active = mission?.status === "RUNNING" || mission?.status === "PAUSED";

  if (!wps.length) return <div className="empty">No waypoints. Click on the map to add WP01.</div>;

  const move = (idx: number, dir: -1 | 1) => {
    const ids = wps.map((w) => w.id);
    const j = idx + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j]!, ids[idx]!];
    onReorder(ids);
  };
  const drop = (targetIdx: number) => {
    if (drag === null || drag === targetIdx) { setDrag(null); setOver(null); return; }
    const ids = wps.map((w) => w.id);
    const [moved] = ids.splice(drag, 1);
    ids.splice(targetIdx, 0, moved!);
    setDrag(null); setOver(null);
    onReorder(ids);
  };
  const commit = (wp: Waypoint, key: "latitude" | "longitude" | "altitude", raw: string) => {
    const v = parseFloat(raw);
    if (!isFinite(v) || v === wp[key]) return;
    onUpdate(wp.id, { [key]: v });
  };

  return (
    <div className="wp-list">
      {wps.map((wp, i) => {
        const cls = active ? (i + 1 < (mission?.current_waypoint ?? 0) ? "done" : i + 1 === mission?.current_waypoint ? "current" : "") : "";
        return (
          <div key={wp.id}
            className={`wp-row ${cls} ${drag === i ? "dragging" : ""} ${over === i ? "over" : ""}`}
            draggable={editable}
            onDragStart={() => setDrag(i)}
            onDragOver={(e) => { e.preventDefault(); setOver(i); }}
            onDragLeave={() => setOver(null)}
            onDrop={() => drop(i)}
            onDragEnd={() => { setDrag(null); setOver(null); }}
          >
            <span className="idx">{i + 1}</span>
            <div className="wp-fields">
              <input className="input sm wp-name" defaultValue={wp.name} disabled={!editable}
                onBlur={(e) => e.target.value !== wp.name && onUpdate(wp.id, { name: e.target.value })} aria-label="Waypoint name" placeholder="Name" />
              <div className="wp-alt-wrap">
                <span className="muted small">Alt</span>
                <input className="input sm wp-alt" type="number" step="1" defaultValue={wp.altitude} disabled={!editable} onBlur={(e) => commit(wp, "altitude", e.target.value)} aria-label="Altitude" />
                <span className="muted small">m</span>
              </div>
              <div className="coords">
                <input className="input sm" type="number" step="0.00001" defaultValue={wp.latitude.toFixed(6)} disabled={!editable} onBlur={(e) => commit(wp, "latitude", e.target.value)} aria-label="Latitude" title="Latitude" />
                <input className="input sm" type="number" step="0.00001" defaultValue={wp.longitude.toFixed(6)} disabled={!editable} onBlur={(e) => commit(wp, "longitude", e.target.value)} aria-label="Longitude" title="Longitude" />
              </div>
            </div>
            <div className="acts">
              <button className="icon-btn" disabled={!editable || i === 0} onClick={() => move(i, -1)} title="Move up"><IconUp /></button>
              <button className="icon-btn" disabled={!editable || i === wps.length - 1} onClick={() => move(i, 1)} title="Move down"><IconDown /></button>
              <button className="icon-btn" disabled={!editable} onClick={() => onDelete(wp.id)} title="Delete"><IconX /></button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
