"""Mô-đun tính toán chỉ số chất lượng không khí tổng hợp (Composite AQI).

Kết hợp dữ liệu từ các cảm biến:
- Bụi mịn PM2.5 (µg/m³) - Tiêu chuẩn US EPA / VN-AQI (QCVN)
- Khí CO (ppm) - Tiêu chuẩn US EPA 8h/1h
- Khí NOx / NO2 (ppb) - Tiêu chuẩn US EPA 1h
- Khí CO2 (ppm) - Tiêu chuẩn thông khí & chất lượng không khí trong nhà
- Khí TVOC (ppb) - Tiêu chuẩn UBA / ENS160
- ENS160 AQI rating (nếu có từ phần cứng)

Nguyên lý tính toán:
Mỗi thông số được quy đổi sang chỉ số thành phần (Sub-index Ip) theo công thức nội suy tuyến tính:
    Ip = [(Ihi - Ilo) / (BPhi - BPlo)] * (Cp - BPlo) + Ilo

Chỉ số AQI tổng thể = max(các chỉ số thành phần Ip).
Chất có Ip cao nhất được xác định là chất ô nhiễm chính (Primary Pollutant).
"""
from __future__ import annotations

from typing import Any, Dict, List, Tuple

# Danh sách điểm phân chia nồng độ (BP_lo, BP_hi, I_lo, I_hi)
# Thang AQI:
# 0 - 50: Tốt (Xanh lá)
# 51 - 100: Trung bình (Vàng)
# 101 - 150: Kém / Không tốt cho nhóm nhạy cảm (Cam)
# 151 - 200: Xấu / Có hại (Đỏ)
# 201 - 300: Rất xấu (Tím)
# 301 - 500: Nguy hiểm (Nâu)

PM25_BREAKPOINTS: List[Tuple[float, float, float, float]] = [
    (0.0, 12.0, 0.0, 50.0),
    (12.1, 35.4, 51.0, 100.0),
    (35.5, 55.4, 101.0, 150.0),
    (55.5, 150.4, 151.0, 200.0),
    (150.5, 250.4, 201.0, 300.0),
    (250.5, 500.0, 301.0, 500.0),
]

CO_BREAKPOINTS: List[Tuple[float, float, float, float]] = [
    (0.0, 4.4, 0.0, 50.0),
    (4.5, 9.4, 51.0, 100.0),
    (9.5, 12.4, 101.0, 150.0),
    (12.5, 15.4, 151.0, 200.0),
    (15.5, 30.4, 201.0, 300.0),
    (30.5, 50.0, 301.0, 500.0),
]

NOX_BREAKPOINTS: List[Tuple[float, float, float, float]] = [
    (0.0, 53.0, 0.0, 50.0),
    (54.0, 100.0, 51.0, 100.0),
    (101.0, 360.0, 101.0, 150.0),
    (361.0, 649.0, 151.0, 200.0),
    (650.0, 1249.0, 201.0, 300.0),
    (1250.0, 2049.0, 301.0, 500.0),
]

CO2_BREAKPOINTS: List[Tuple[float, float, float, float]] = [
    (400.0, 600.0, 0.0, 50.0),
    (601.0, 1000.0, 51.0, 100.0),
    (1001.0, 1500.0, 101.0, 150.0),
    (1501.0, 2000.0, 151.0, 200.0),
    (2001.0, 3000.0, 201.0, 300.0),
    (3001.0, 5000.0, 301.0, 500.0),
]

TVOC_BREAKPOINTS: List[Tuple[float, float, float, float]] = [
    (0.0, 65.0, 0.0, 50.0),
    (66.0, 220.0, 51.0, 100.0),
    (221.0, 660.0, 101.0, 150.0),
    (661.0, 2200.0, 151.0, 200.0),
    (2201.0, 5500.0, 201.0, 300.0),
    (5501.0, 10000.0, 301.0, 500.0),
]


def calc_sub_index(conc: float, breakpoints: List[Tuple[float, float, float, float]]) -> float:
    """Tính chỉ số phụ Ip bằng nội suy tuyến tính theo khoảng nồng độ."""
    if conc <= 0:
        return 0.0
    for bp_lo, bp_hi, i_lo, i_hi in breakpoints:
        if conc <= bp_hi:
            if bp_hi == bp_lo:
                return i_lo
            val = ((i_hi - i_lo) / (bp_hi - bp_lo)) * (conc - bp_lo) + i_lo
            return max(0.0, min(500.0, val))
    # Nồng độ vượt ngưỡng cao nhất
    bp_lo, bp_hi, i_lo, i_hi = breakpoints[-1]
    val = ((i_hi - i_lo) / (bp_hi - bp_lo)) * (conc - bp_lo) + i_lo
    return max(0.0, min(500.0, val))


def calculate_aqi_details(data: Dict[str, Any]) -> Dict[str, Any]:
    """Tính toán chi tiết các sub-index và AQI tổng hợp từ dictionary cảm biến."""
    sub_indices: Dict[str, float] = {}

    pm25 = data.get("pm25")
    if pm25 is not None and pm25 > 0:
        sub_indices["pm25"] = round(calc_sub_index(float(pm25), PM25_BREAKPOINTS), 1)

    co = data.get("co")
    if co is not None and co > 0:
        sub_indices["co"] = round(calc_sub_index(float(co), CO_BREAKPOINTS), 1)

    nox = data.get("nox")
    if nox is not None and nox > 0:
        sub_indices["nox"] = round(calc_sub_index(float(nox), NOX_BREAKPOINTS), 1)

    co2 = data.get("co2")
    if co2 is not None and co2 > 0:
        sub_indices["co2"] = round(calc_sub_index(float(co2), CO2_BREAKPOINTS), 1)

    tvoc = data.get("tvoc")
    if tvoc is not None and tvoc > 0:
        sub_indices["tvoc"] = round(calc_sub_index(float(tvoc), TVOC_BREAKPOINTS), 1)

    # Đọc ENS160 AQI nếu có (thường 1-5 hoặc điểm số 0-500)
    raw_aqi = data.get("aqi")
    if raw_aqi is not None and raw_aqi > 0:
        raw_val = float(raw_aqi)
        if raw_val <= 5.0:
            ens_map = {1.0: 25.0, 2.0: 65.0, 3.0: 125.0, 4.0: 175.0, 5.0: 250.0}
            sub_indices["ens160"] = ens_map.get(raw_val, 50.0)
        else:
            sub_indices["ens160"] = raw_val

    if not sub_indices:
        return {"aqi": 0.0, "primary_pollutant": "none", "sub_indices": {}}

    primary_key = max(sub_indices, key=lambda k: sub_indices[k])
    max_aqi = sub_indices[primary_key]

    return {
        "aqi": round(max_aqi, 0),
        "primary_pollutant": primary_key,
        "sub_indices": sub_indices,
    }


def calculate_composite_aqi(data: Dict[str, Any]) -> float:
    """Trả về chỉ số AQI tổng hợp dạng số float."""
    return float(calculate_aqi_details(data)["aqi"])


def get_aqi_category(aqi: float) -> Dict[str, str]:
    """Phân loại mức độ chất lượng không khí và khuyến nghị sức khỏe tương ứng."""
    if aqi <= 50:
        return {
            "level": "GOOD",
            "label": "Tốt",
            "color": "green",
            "badge": "ok",
            "recommendation": "Tuyệt vời. Hoạt động ngoài trời thoải mái, có thể mở cửa thông phòng.",
        }
    if aqi <= 100:
        return {
            "level": "MODERATE",
            "label": "Trung bình",
            "color": "yellow",
            "badge": "warn",
            "recommendation": "Mức chấp nhận được. Nhóm người cực kỳ nhạy cảm (hen suyễn nặng) nên hạn chế vận động mạnh ngoài trời.",
        }
    if aqi <= 150:
        return {
            "level": "UNHEALTHY_SENSITIVE",
            "label": "Kém / Không tốt cho nhóm nhạy cảm",
            "color": "orange",
            "badge": "warn",
            "recommendation": "Trẻ em, người già, người bệnh tim/hô hấp nên giảm thời gian ra đường.",
        }
    if aqi <= 200:
        return {
            "level": "UNHEALTHY",
            "label": "Xấu / Có hại",
            "color": "red",
            "badge": "danger",
            "recommendation": "Mọi người bắt đầu bị ảnh hưởng. Nên đeo khẩu trang chống bụi mịn (N95) khi ra ngoài.",
        }
    if aqi <= 300:
        return {
            "level": "VERY_UNHEALTHY",
            "label": "Rất xấu",
            "color": "purple",
            "badge": "danger",
            "recommendation": "Rất có hại. Mọi người nên đóng cửa sổ, bật máy lọc không khí và hạn chế ra ngoài.",
        }
    return {
        "level": "HAZARDOUS",
        "label": "Nguy hiểm",
        "color": "brown",
        "badge": "danger",
        "recommendation": "Tình trạng khẩn cấp. Tất cả mọi người nên ở trong nhà.",
    }
