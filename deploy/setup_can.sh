#!/usr/bin/env bash
# ==============================================================================
# Script cấu hình SocketCAN (MCP2515 SPI) cho Jetson / Raspberry Pi
# ==============================================================================
# Sử dụng:
#   chmod +x deploy/setup_can.sh
#   sudo ./deploy/setup_can.sh [interface] [bitrate]
# Ví dụ:
#   sudo ./deploy/setup_can.sh can0 500000
# ==============================================================================

set -e

CAN_IFACE="${1:-can0}"
CAN_BITRATE="${2:-500000}"

echo "========================================================"
echo " Thiết lập SocketCAN cho MCP2515"
echo " Kênh: $CAN_IFACE | Bitrate: $CAN_BITRATE bps"
echo "========================================================"

# Kiểm tra quyền root
if [ "$EUID" -ne 0 ]; then
  echo "[-] Vui lòng chạy bằng quyền root (sudo)"
  exit 1
fi

# Load các kernel module liên quan đến CAN
echo "[*] Đang nạp kernel module can, can_raw, mcp251x..."
modprobe can || true
modprobe can_raw || true
modprobe mcp251x || true

# Tắt interface nếu đang bật
if ip link show "$CAN_IFACE" &> /dev/null; then
  echo "[*] Hạ interface $CAN_IFACE..."
  ip link set "$CAN_IFACE" down || true
else
  echo "[!] Chú ý: Chưa tìm thấy interface $CAN_IFACE trong kernel."
  echo "    Hãy đảm bảo đã bật Device Tree Overlay cho MCP2515 trên Jetson/Pi:"
  echo "    - Jetson: Kích hoạt SPI qua jetson-io.py hoặc nạp overlay mcp2515"
  echo "    - Raspberry Pi: thêm dtoverlay=mcp2515-can0,oscillator=8000000,interrupt=25 vào /boot/config.txt"
fi

# Cấu hình bitrate và bật interface
echo "[*] Thiết lập bitrate $CAN_BITRATE và kích hoạt $CAN_IFACE..."
ip link set "$CAN_IFACE" type can bitrate "$CAN_BITRATE" restart-ms 100
ip link set "$CAN_IFACE" up

echo "[+] $CAN_IFACE đã sẵn sàng!"
ip -details link show "$CAN_IFACE"

echo ""
echo "========================================================"
echo " Kiểm tra dữ liệu thực tế từ ESP32 bằng lệnh:"
echo "   candump $CAN_IFACE"
echo "   (Cần cài can-utils: sudo apt-get install -y can-utils)"
echo "========================================================"
