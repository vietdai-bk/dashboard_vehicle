"""Dịch vụ tìm đường đi ngắn nhất theo đường phố (OSRM Routing) & trích xuất khúc cua."""
from __future__ import annotations

import json
import logging
import math
import urllib.request
from typing import Any, Optional

from ..core.state import haversine_m

log = logging.getLogger("routing")

OSRM_API_URL = "https://router.project-osrm.org/route/v1/driving"


def bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    x = math.sin(dl) * math.cos(p2)
    y = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def extract_turns_from_osrm(
    route_data: dict[str, Any],
    target_waypoints: Optional[list[Any]] = None,
) -> list[dict[str, Any]]:
    """
    Trích xuất các điểm cần gắn Waypoint từ OSRM maneuvers:
    1. Điểm xuất phát (đầu lộ trình)
    2. Các khúc cua thực sự (turn, uturn, roundabout, fork...)
    3. Các điểm mục tiêu (target waypoints) được snap chính xác lên mặt đường
    TUYỆT ĐỐI KHÔNG gắn waypoint trên các đoạn đường thẳng.
    TẤT CẢ các điểm đều 100% nằm trên lộ trình đã vạch (route_points).
    """
    geojson_coords = route_data.get("geometry", {}).get("coordinates", [])
    coords: list[list[float]] = [[round(pt[1], 7), round(pt[0], 7)] for pt in geojson_coords]
    if len(coords) < 2:
        return []

    targets = list(target_waypoints or [])
    selected: list[dict[str, Any]] = []

    # 1. Điểm xuất phát (nằm trên đường đã vạch tại vị trí đầu tiên)
    selected.append({
        "id": 1,
        "lat": coords[0][0],
        "lon": coords[0][1],
        "alt": 0.0,
        "name": "Xuất phát",
        "is_turn": False,
        "is_target": False,
    })

    turn_counter = 1
    legs = route_data.get("legs", [])

    for leg_idx, leg in enumerate(legs):
        target_for_leg = targets[leg_idx] if leg_idx < len(targets) else None
        steps = leg.get("steps", [])

        for s in steps:
            m = s.get("maneuver", {})
            m_type = m.get("type", "")
            m_mod = m.get("modifier", "")
            loc = m.get("location", [])
            if len(loc) < 2:
                continue

            raw_lat = round(loc[1], 7)
            raw_lon = round(loc[0], 7)

            # Snap loc chính xác vào vertex trong coords (đảm bảo 100% nằm trên đường đã vạch)
            best_coord = min(coords, key=lambda c: haversine_m(raw_lat, raw_lon, c[0], c[1]))
            lat, lon = best_coord[0], best_coord[1]

            # Kiểm tra xem có trùng hoặc quá gần điểm trước đó (< 5m) không
            last = selected[-1]
            dist_to_last = haversine_m(last["lat"], last["lon"], lat, lon)

            if dist_to_last < 5.0:
                # Nếu đây là điểm arrive (đích của leg), cập nhật lại tên thành tên waypoint mục tiêu
                if m_type == "arrive" and target_for_leg:
                    target_name = getattr(target_for_leg, "name", "") or f"WP{leg_idx + 1:02d}"
                    last["name"] = target_name
                    last["is_target"] = True
                continue

            # Xử lý điểm đến của chặng (arrive)
            if m_type == "arrive":
                target_name = ""
                if target_for_leg:
                    target_name = getattr(target_for_leg, "name", "")
                name = target_name or f"WP{leg_idx + 1:02d}"
                selected.append({
                    "id": len(selected) + 1,
                    "lat": lat,
                    "lon": lon,
                    "alt": getattr(target_for_leg, "altitude", 0.0) if target_for_leg else 0.0,
                    "name": name,
                    "is_turn": False,
                    "is_target": True,
                })
            # Xử lý khúc cua thực sự (turn / fork / roundabout / uturn)
            elif m_type in ("turn", "end of road", "fork", "roundabout", "rotary") or m_mod in (
                "left", "right", "sharp left", "sharp right", "slight left", "slight right", "uturn"
            ):
                if "sharp left" in m_mod:
                    label = "Cua gấp trái"
                elif "sharp right" in m_mod:
                    label = "Cua gấp phải"
                elif "slight left" in m_mod:
                    label = "Rẽ chếch trái"
                elif "slight right" in m_mod:
                    label = "Rẽ chếch phải"
                elif "left" in m_mod:
                    label = "Rẽ trái"
                elif "right" in m_mod:
                    label = "Rẽ phải"
                elif "uturn" in m_mod:
                    label = "Quay đầu"
                else:
                    label = f"Khúc cua {turn_counter}"

                selected.append({
                    "id": len(selected) + 1,
                    "lat": lat,
                    "lon": lon,
                    "alt": 0.0,
                    "name": label,
                    "is_turn": True,
                    "is_target": False,
                })
                turn_counter += 1

    # Đảm bảo điểm kết thúc cuối cùng của lộ trình nằm trong danh sách
    last_coord = coords[-1]
    last_pt = selected[-1]
    if haversine_m(last_pt["lat"], last_pt["lon"], last_coord[0], last_coord[1]) >= 8.0:
        final_target = targets[-1] if targets else None
        final_name = getattr(final_target, "name", "") if final_target else "Đích đến"
        selected.append({
            "id": len(selected) + 1,
            "lat": last_coord[0],
            "lon": last_coord[1],
            "alt": getattr(final_target, "altitude", 0.0) if final_target else 0.0,
            "name": final_name or "Đích đến",
            "is_turn": False,
            "is_target": True,
        })

    for idx, item in enumerate(selected):
        item["id"] = idx + 1

    return selected


def extract_turn_points_geometry(
    route_points: list[list[float]],
    target_waypoints: Optional[list[Any]] = None,
    min_angle_deg: float = 28.0,
    min_dist_m: float = 8.0,
) -> list[dict[str, Any]]:
    """
    Fallback trích xuất khúc cua từ hình học tọa độ (khi OSRM steps không khả dụng).
    TUYỆT ĐỐI KHÔNG gắn waypoint trên đoạn thẳng.
    TẤT CẢ các điểm đều là vertex của route_points.
    """
    if not route_points:
        return []
    if len(route_points) <= 2:
        return [
            {
                "id": i + 1,
                "lat": round(pt[0], 7),
                "lon": round(pt[1], 7),
                "alt": 0.0,
                "name": f"WP{i + 1:02d}",
                "is_turn": False,
                "is_target": True,
            }
            for i, pt in enumerate(route_points)
        ]

    targets = list(target_waypoints or [])
    selected: list[dict[str, Any]] = [{
        "id": 1,
        "lat": round(route_points[0][0], 7),
        "lon": round(route_points[0][1], 7),
        "alt": 0.0,
        "name": "Xuất phát",
        "is_turn": False,
        "is_target": False,
    }]

    last_pt = route_points[0]
    turn_counter = 1

    for i in range(1, len(route_points) - 1):
        prev_pt = route_points[i - 1]
        curr_pt = route_points[i]
        next_pt = route_points[i + 1]

        d_from_last = haversine_m(last_pt[0], last_pt[1], curr_pt[0], curr_pt[1])

        # Kiểm tra mục tiêu (target waypoint)
        matching_target = None
        for twp in targets:
            twp_lat = getattr(twp, "latitude", twp[0] if isinstance(twp, (list, tuple)) else 0.0)
            twp_lon = getattr(twp, "longitude", twp[1] if isinstance(twp, (list, tuple)) else 0.0)
            if haversine_m(curr_pt[0], curr_pt[1], twp_lat, twp_lon) <= 15.0:
                matching_target = twp
                break

        b1 = bearing_deg(prev_pt[0], prev_pt[1], curr_pt[0], curr_pt[1])
        b2 = bearing_deg(curr_pt[0], curr_pt[1], next_pt[0], next_pt[1])
        angle_diff = abs((b2 - b1 + 180) % 360 - 180)

        is_turn = (angle_diff >= min_angle_deg and d_from_last >= min_dist_m)

        if matching_target is not None:
            name = getattr(matching_target, "name", "") or f"Đích {len(selected)}"
            selected.append({
                "id": len(selected) + 1,
                "lat": round(curr_pt[0], 7),
                "lon": round(curr_pt[1], 7),
                "alt": getattr(matching_target, "altitude", 0.0),
                "name": name,
                "is_turn": False,
                "is_target": True,
            })
            last_pt = curr_pt
        elif is_turn:
            selected.append({
                "id": len(selected) + 1,
                "lat": round(curr_pt[0], 7),
                "lon": round(curr_pt[1], 7),
                "alt": 0.0,
                "name": f"Khúc cua {turn_counter}",
                "is_turn": True,
                "is_target": False,
            })
            turn_counter += 1
            last_pt = curr_pt

    # Điểm cuối cùng (đích đến)
    last_route_pt = route_points[-1]
    if haversine_m(last_pt[0], last_pt[1], last_route_pt[0], last_route_pt[1]) >= 5.0 or len(selected) == 1:
        target_name = getattr(targets[-1], "name", "Đích đến") if targets else "Đích đến"
        selected.append({
            "id": len(selected) + 1,
            "lat": round(last_route_pt[0], 7),
            "lon": round(last_route_pt[1], 7),
            "alt": getattr(targets[-1], "altitude", 0.0) if targets else 0.0,
            "name": target_name or "Đích đến",
            "is_turn": False,
            "is_target": True,
        })

    for idx, item in enumerate(selected):
        item["id"] = idx + 1

    return selected


def extract_turn_points(
    route_points: list[list[float]],
    target_waypoints: Optional[list[Any]] = None,
) -> list[dict[str, Any]]:
    """API tương thích ngược trích xuất các điểm cua."""
    return extract_turn_points_geometry(route_points, target_waypoints)


def calculate_street_route(
    start: tuple[float, float],
    waypoints: list[tuple[float, float]],
    timeout: float = 6.0,
) -> dict[str, Any]:
    """
    Tính toán đường đi ngắn nhất theo đường phố:
    start -> waypoint_1 -> waypoint_2 -> ... -> waypoint_N.
    start: (lat, lon) của xe hoặc điểm xuất phát.
    waypoints: danh sách (lat, lon).
    Trả về dict: {"route": [[lat, lon], ...], "turn_points": [...], "distance_m": float, "duration_s": float, "is_street": bool}
    """
    points = [start] + list(waypoints)
    if len(points) < 2:
        turn_pts = extract_turn_points_geometry([[p[0], p[1]] for p in points], waypoints)
        return {
            "route": [[p[0], p[1]] for p in points],
            "turn_points": turn_pts,
            "distance_m": 0.0,
            "duration_s": 0.0,
            "is_street": False,
        }

    # OSRM nhận định dạng {lon},{lat};{lon},{lat}...
    coords_str = ";".join(f"{lon:.6f},{lat:.6f}" for lat, lon in points)
    url = f"{OSRM_API_URL}/{coords_str}?overview=full&geometries=geojson&steps=true"

    try:
        req = urllib.request.Request(url, headers={"User-Agent": "VehicleDashboard/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))

        if data.get("code") == "Ok" and data.get("routes"):
            route_data = data["routes"][0]
            geojson_coords = route_data["geometry"]["coordinates"]
            latlngs = [[round(pt[1], 7), round(pt[0], 7)] for pt in geojson_coords]
            distance_m = round(float(route_data.get("distance", 0.0)), 1)
            duration_s = round(float(route_data.get("duration", 0.0)), 1)
            turn_points = extract_turns_from_osrm(route_data, waypoints)
            return {
                "route": latlngs,
                "turn_points": turn_points,
                "distance_m": distance_m,
                "duration_s": duration_s,
                "is_street": True,
            }
        log.warning("OSRM returned code %s: %s", data.get("code"), data.get("message"))
    except Exception as exc:  # noqa: BLE001
        log.warning("OSRM routing request failed: %s, falling back to direct lines", exc)

    # Fallback: Đường thẳng giữa các điểm
    total_dist = 0.0
    for a, b in zip(points, points[1:]):
        total_dist += haversine_m(a[0], a[1], b[0], b[1])
    latlngs = [[round(p[0], 7), round(p[1], 7)] for p in points]
    turn_points = extract_turn_points_geometry(latlngs, waypoints)
    return {
        "route": latlngs,
        "turn_points": turn_points,
        "distance_m": round(total_dist, 1),
        "duration_s": round(total_dist / 8.0, 1),
        "is_street": False,
    }
