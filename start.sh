#!/usr/bin/env bash
# Khởi động dashboard: tạo venv nếu chưa có, cài deps, build frontend nếu thiếu, chạy server.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d .venv ]; then
  echo "[start] creating virtualenv .venv"
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
python -c "import fastapi, uvicorn, serial" 2>/dev/null || pip install -r requirements.txt

if [ ! -f frontend/dist/index.html ]; then
  echo "[start] frontend/dist missing -> building (needs Node.js 18+)"
  (cd frontend && npm install && npm run build)
fi

[ -f .env ] || cp .env.example .env
exec python server.py
