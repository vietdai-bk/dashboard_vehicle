#!/usr/bin/env bash
# Cài đặt trên Raspberry Pi OS (Bookworm/Bullseye): venv + deps + systemd service.
# Chạy trong thư mục project: bash deploy/install_pi.sh
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT_DIR="$(pwd)"
RUN_USER="${SUDO_USER:-$USER}"

echo "[1/4] python venv + dependencies"
python3 -m venv .venv
.venv/bin/pip install --upgrade pip >/dev/null
.venv/bin/pip install -r requirements.txt

echo "[2/4] config"
[ -f .env ] || cp .env.example .env
mkdir -p data

if [ ! -f frontend/dist/index.html ]; then
  echo "[3/4] frontend/dist missing -> building (requires Node.js 18+)"
  (cd frontend && npm install && npm run build)
else
  echo "[3/4] frontend/dist present (prebuilt) - skip npm"
fi

echo "[4/4] systemd service"
sed -e "s#^User=.*#User=${RUN_USER}#" \
    -e "s#/home/pi/vehicle-dashboard#${PROJECT_DIR}#g" \
    deploy/vehicle-dashboard.service | sudo tee /etc/systemd/system/vehicle-dashboard.service >/dev/null
sudo usermod -aG dialout "${RUN_USER}" || true
sudo systemctl daemon-reload
sudo systemctl enable --now vehicle-dashboard.service
sleep 2
sudo systemctl --no-pager --lines=5 status vehicle-dashboard.service || true
IP=$(hostname -I | awk '{print $1}')
echo
echo "Dashboard: http://${IP}:$(grep -E '^SERVER_PORT' .env | cut -d= -f2 | tr -d ' ' || echo 8000)/  (login: xem AUTH_USERNAME/AUTH_PASSWORD trong .env)"
