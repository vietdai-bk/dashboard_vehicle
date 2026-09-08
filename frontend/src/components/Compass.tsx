import { useSmoothHeading } from "../hooks/useSmoothHeading";

/** La bàn SVG: kim xoay mượt theo heading (transition CSS, góc liên tục không wrap). */
export function Compass({ heading }: { heading: number }) {
  const smooth = useSmoothHeading(heading);
  const ticks = [];
  for (let d = 0; d < 360; d += 10) {
    const major = d % 90 === 0;
    const mid = d % 30 === 0;
    const r1 = major ? 70 : mid ? 76 : 80;
    const a = (d * Math.PI) / 180;
    ticks.push(
      <line key={d} className={`tick ${major ? "major" : ""}`}
        x1={100 + r1 * Math.sin(a)} y1={100 - r1 * Math.cos(a)} x2={100 + 86 * Math.sin(a)} y2={100 - 86 * Math.cos(a)} />,
    );
  }
  return (
    <svg className="compass" viewBox="0 0 200 200" role="img" aria-label={`Heading ${Math.round(heading)} degrees`}>
      <circle className="ring" cx="100" cy="100" r="92" />
      {ticks}
      <text className="cardinal n" x="100" y="24">N</text>
      <text className="cardinal" x="176" y="100">E</text>
      <text className="cardinal" x="100" y="176">S</text>
      <text className="cardinal" x="24" y="100">W</text>
      <g className="needle" style={{ transform: `rotate(${smooth}deg)` }}>
        <path d="M100 36 L108 100 L92 100 Z" />
        <path className="tail" d="M100 164 L108 100 L92 100 Z" />
      </g>
      <circle cx="100" cy="100" r="30" fill="var(--surface)" stroke="var(--line)" />
      <text className="center-text" x="100" y="98">{Math.round(((heading % 360) + 360) % 360)}°</text>
      <text className="center-sub" x="100" y="116">HDG</text>
    </svg>
  );
}
