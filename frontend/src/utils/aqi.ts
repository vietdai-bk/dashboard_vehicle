/**
 * Tiện ích tính toán và phân loại chỉ số chất lượng không khí tổng hợp (Composite AQI).
 *
 * Kết hợp đa cảm biến:
 * - Bụi mịn PM2.5 (µg/m³)
 * - Khí CO (ppm)
 * - Khí NOx (ppb)
 * - Khí CO₂ (ppm)
 * - Khí TVOC (ppb)
 *
 * Thang đánh giá & Khuyến nghị hành động chuẩn:
 * - 0 – 50: Tốt (Xanh lá)
 * - 51 – 100: Trung bình (Vàng)
 * - 101 – 150: Kém / Không tốt cho nhóm nhạy cảm (Cam)
 * - 151 – 200: Xấu / Có hại (Đỏ)
 * - 201 – 300: Rất xấu (Tím)
 * - Trên 300: Nguy hiểm (Nâu)
 */
import type { Telemetry } from "../types";

export interface AqiScaleLevel {
  range: string;
  min: number;
  max: number;
  label: string;
  colorName: string;
  bg: string;
  fg: string;
  border: string;
  recommendation: string;
}

export const AQI_SCALE: AqiScaleLevel[] = [
  {
    range: "0 – 50",
    min: 0,
    max: 50,
    label: "Tốt",
    colorName: "Xanh lá",
    bg: "#dcfce7",
    fg: "#15803d",
    border: "#86efac",
    recommendation: "Tuyệt vời. Hoạt động ngoài trời thoải mái, có thể mở cửa thông phòng.",
  },
  {
    range: "51 – 100",
    min: 51,
    max: 100,
    label: "Trung bình",
    colorName: "Vàng",
    bg: "#fef9c3",
    fg: "#a16207",
    border: "#fde047",
    recommendation: "Mức chấp nhận được. Nhóm người cực kỳ nhạy cảm (hen suyễn nặng) nên hạn chế vận động mạnh ngoài trời.",
  },
  {
    range: "101 – 150",
    min: 101,
    max: 150,
    label: "Kém / Không tốt cho nhóm nhạy cảm",
    colorName: "Cam",
    bg: "#ffedd5",
    fg: "#c2410c",
    border: "#fdba74",
    recommendation: "Trẻ em, người già, người bệnh tim/hô hấp nên giảm thời gian ra đường.",
  },
  {
    range: "151 – 200",
    min: 151,
    max: 200,
    label: "Xấu / Có hại",
    colorName: "Đỏ",
    bg: "#fee2e2",
    fg: "#b91c1c",
    border: "#fca5a5",
    recommendation: "Mọi người bắt đầu bị ảnh hưởng. Nên đeo khẩu trang chống bụi mịn (N95) khi ra ngoài.",
  },
  {
    range: "201 – 300",
    min: 201,
    max: 300,
    label: "Rất xấu",
    colorName: "Tím",
    bg: "#f3e8ff",
    fg: "#7e22ce",
    border: "#d8b4fe",
    recommendation: "Rất có hại. Mọi người nên đóng cửa sổ, bật máy lọc không khí và hạn chế ra ngoài.",
  },
  {
    range: "Trên 300",
    min: 301,
    max: 500,
    label: "Nguy hiểm",
    colorName: "Nâu",
    bg: "#fef2f2",
    fg: "#78350f",
    border: "#b45309",
    recommendation: "Tình trạng khẩn cấp. Tất cả mọi người nên ở trong nhà.",
  },
];

export function getAqiInfo(aqi: number): AqiScaleLevel {
  if (aqi <= 50) return AQI_SCALE[0]!;
  if (aqi <= 100) return AQI_SCALE[1]!;
  if (aqi <= 150) return AQI_SCALE[2]!;
  if (aqi <= 200) return AQI_SCALE[3]!;
  if (aqi <= 300) return AQI_SCALE[4]!;
  return AQI_SCALE[5]!;
}

// Bảng breakpoints tính sub-index từng chất (US EPA / VN-AQI)
type Breakpoint = [number, number, number, number];

const PM25_BP: Breakpoint[] = [
  [0.0, 12.0, 0, 50],
  [12.1, 35.4, 51, 100],
  [35.5, 55.4, 101, 150],
  [55.5, 150.4, 151, 200],
  [150.5, 250.4, 201, 300],
  [250.5, 500.0, 301, 500],
];

const CO_BP: Breakpoint[] = [
  [0.0, 4.4, 0, 50],
  [4.5, 9.4, 51, 100],
  [9.5, 12.4, 101, 150],
  [12.5, 15.4, 151, 200],
  [15.5, 30.4, 201, 300],
  [30.5, 50.0, 301, 500],
];

const NOX_BP: Breakpoint[] = [
  [0.0, 53.0, 0, 50],
  [54.0, 100.0, 51, 100],
  [101.0, 360.0, 101, 150],
  [361.0, 649.0, 151, 200],
  [650.0, 1249.0, 201, 300],
  [1250.0, 2049.0, 301, 500],
];

const CO2_BP: Breakpoint[] = [
  [400.0, 600.0, 0, 50],
  [601.0, 1000.0, 51, 100],
  [1001.0, 1500.0, 101, 150],
  [1501.0, 2000.0, 151, 200],
  [2001.0, 3000.0, 201, 300],
  [3001.0, 5000.0, 301, 500],
];

const TVOC_BP: Breakpoint[] = [
  [0.0, 65.0, 0, 50],
  [66.0, 220.0, 51, 100],
  [221.0, 660.0, 101, 150],
  [661.0, 2200.0, 151, 200],
  [2201.0, 5500.0, 201, 300],
  [5501.0, 10000.0, 301, 500],
];

function calcLinearSubIndex(conc: number, breakpoints: Breakpoint[]): number {
  if (conc <= 0) return 0;
  for (const [bpLo, bpHi, iLo, iHi] of breakpoints) {
    if (conc <= bpHi) {
      if (bpHi === bpLo) return iLo;
      const val = ((iHi - iLo) / (bpHi - bpLo)) * (conc - bpLo) + iLo;
      return Math.max(0, Math.min(500, val));
    }
  }
  const [bpLo, bpHi, iLo, iHi] = breakpoints[breakpoints.length - 1]!;
  const val = ((iHi - iLo) / (bpHi - bpLo)) * (conc - bpLo) + iLo;
  return Math.max(0, Math.min(500, val));
}

export interface PollutantDetail {
  key: string;
  name: string;
  unit: string;
  value: number;
  subIndex: number;
}

export interface CompositeAqiResult {
  aqi: number;
  primaryPollutant: PollutantDetail | null;
  pollutants: PollutantDetail[];
  category: AqiScaleLevel;
}

export function evaluateCompositeAqi(t: Partial<Telemetry>): CompositeAqiResult {
  const pollutants: PollutantDetail[] = [];

  if (t.pm25 != null && t.pm25 > 0) {
    pollutants.push({
      key: "pm25",
      name: "Bụi mịn PM2.5",
      unit: "µg/m³",
      value: t.pm25,
      subIndex: Math.round(calcLinearSubIndex(t.pm25, PM25_BP)),
    });
  }

  if (t.co != null && t.co > 0) {
    pollutants.push({
      key: "co",
      name: "Khí CO",
      unit: "ppm",
      value: t.co,
      subIndex: Math.round(calcLinearSubIndex(t.co, CO_BP)),
    });
  }

  if (t.nox != null && t.nox > 0) {
    pollutants.push({
      key: "nox",
      name: "Khí NOx",
      unit: "ppb",
      value: t.nox,
      subIndex: Math.round(calcLinearSubIndex(t.nox, NOX_BP)),
    });
  }

  if (t.co2 != null && t.co2 > 0) {
    pollutants.push({
      key: "co2",
      name: "Khí CO₂",
      unit: "ppm",
      value: t.co2,
      subIndex: Math.round(calcLinearSubIndex(t.co2, CO2_BP)),
    });
  }

  if (t.tvoc != null && t.tvoc > 0) {
    pollutants.push({
      key: "tvoc",
      name: "Khí TVOC",
      unit: "ppb",
      value: t.tvoc,
      subIndex: Math.round(calcLinearSubIndex(t.tvoc, TVOC_BP)),
    });
  }

  let finalAqi = 0;
  let primary: PollutantDetail | null = null;

  if (pollutants.length > 0) {
    pollutants.sort((a, b) => b.subIndex - a.subIndex);
    primary = pollutants[0] ?? null;
    finalAqi = primary?.subIndex ?? 0;
  } else if (t.aqi != null && t.aqi > 0) {
    finalAqi = t.aqi;
  }

  const category = getAqiInfo(finalAqi);

  return {
    aqi: finalAqi,
    primaryPollutant: primary,
    pollutants,
    category,
  };
}
