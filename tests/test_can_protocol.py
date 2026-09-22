"""Kiểm thử giải mã frame CAN bus 0x555 và 0x556 từ ESP32 MCP2515."""
import struct
import unittest
from backend.hardware.protocol import decode_can_frame, ProtocolError
from backend.core.state import VehicleStateStore


class TestCANProtocol(unittest.TestCase):
    def test_decode_frame_0x555(self):
        # ESP32 gửi:
        # temperature = 28.45 -> int16: 2845
        # humidity = 71.20 -> uint16: 7120
        # tvoc = 150 -> uint16: 150
        # eco2 = 620 -> uint16: 620
        temp_raw = 2845
        hum_raw = 7120
        tvoc_raw = 150
        eco2_raw = 620
        payload = struct.pack(">hHHH", temp_raw, hum_raw, tvoc_raw, eco2_raw)

        pkt = decode_can_frame(0x555, payload)
        self.assertIsNotNone(pkt)
        self.assertEqual(pkt["type"], "sensor")
        self.assertEqual(pkt["temperature"], 28.45)
        self.assertEqual(pkt["humidity"], 71.2)
        self.assertEqual(pkt["tvoc"], 150.0)
        self.assertEqual(pkt["co2"], 620.0)

    def test_decode_frame_0x555_negative_temp(self):
        # Nhiệt độ âm: -5.50 -> int16: -550
        temp_raw = -550
        hum_raw = 4500
        tvoc_raw = 80
        eco2_raw = 400
        payload = struct.pack(">hHHH", temp_raw, hum_raw, tvoc_raw, eco2_raw)

        pkt = decode_can_frame(0x555, payload)
        self.assertIsNotNone(pkt)
        self.assertEqual(pkt["temperature"], -5.5)
        self.assertEqual(pkt["humidity"], 45.0)

    def test_decode_frame_0x556(self):
        # ESP32 gửi:
        # co = 2.4 -> uint16: 24 (co * 10.0)
        # no2 = 1.8 -> uint16: 18 (no2 * 10.0)
        # pm25 = 15.65 -> uint16: 1565 (pm25 * 100.0)
        # aqi = 42
        # reserved = 0
        co_raw = 24
        no2_raw = 18
        pm_raw = 1565
        aqi_raw = 42
        payload = struct.pack(">HHHBx", co_raw, no2_raw, pm_raw, aqi_raw)

        pkt = decode_can_frame(0x556, payload)
        self.assertIsNotNone(pkt)
        self.assertEqual(pkt["type"], "sensor")
        self.assertEqual(pkt["co"], 2.4)
        self.assertEqual(pkt["nox"], 1.8)
        self.assertEqual(pkt["pm25"], 15.65)
        self.assertEqual(pkt["aqi"], 42.0)

    def test_invalid_length_and_id(self):
        # Ngắn hơn 8 bytes đối với 0x555
        with self.assertRaises(ProtocolError):
            decode_can_frame(0x555, b"\x01\x02\x03")

        # ID không xác định
        self.assertIsNone(decode_can_frame(0x123, b"\x00" * 8))

    def test_sensor_state_merge(self):
        # Kiểm tra rằng khi 0x555 và 0x556 đến liên tiếp nhau,
        # cả 2 frame cùng hợp nhất vào Telemetry mà không bị ghi đè xóa nhau
        store = VehicleStateStore()

        frame1_payload = struct.pack(">hHHH", 2950, 6800, 120, 550)
        pkt1 = decode_can_frame(0x555, frame1_payload)
        self.assertIsNotNone(pkt1)
        store.apply_packet(pkt1)

        self.assertEqual(store.telemetry.temperature, 29.5)
        self.assertEqual(store.telemetry.humidity, 68.0)
        self.assertEqual(store.telemetry.tvoc, 120.0)
        self.assertEqual(store.telemetry.co2, 550.0)

        frame2_payload = struct.pack(">HHHBx", 15, 30, 2500, 35)
        pkt2 = decode_can_frame(0x556, frame2_payload)
        self.assertIsNotNone(pkt2)
        store.apply_packet(pkt2)

        # Frame 2 đã cập nhật
        self.assertEqual(store.telemetry.co, 1.5)
        self.assertEqual(store.telemetry.nox, 3.0)
        self.assertEqual(store.telemetry.pm25, 25.0)
        self.assertEqual(store.telemetry.aqi, 35.0)

        # Các giá trị từ Frame 1 VẪN ĐƯỢC GIỮ NGUYÊN (không bị reset về 0)
        self.assertEqual(store.telemetry.temperature, 29.5)
        self.assertEqual(store.telemetry.humidity, 68.0)
        self.assertEqual(store.telemetry.tvoc, 120.0)
        self.assertEqual(store.telemetry.co2, 550.0)


if __name__ == "__main__":
    unittest.main()

