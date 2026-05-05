#!/usr/bin/env bash
# MAFT — start backend (3001) and frontend (5173) dev servers in background.
# Logs go to scripts/.run/. Health is verified before returning.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT/scripts/.run"
mkdir -p "$RUN_DIR"

abort_if_busy() {
  local port=$1
  if lsof -ti:"$port" >/dev/null 2>&1; then
    echo "✗ port $port is already in use. run scripts/dev-down.sh first."
    exit 1
  fi
}

abort_if_busy 3001
abort_if_busy 5173

cd "$ROOT/server"
nohup npm run dev > "$RUN_DIR/server.log" 2>&1 &
echo $! > "$RUN_DIR/server.pid"
SERVER_PID=$(cat "$RUN_DIR/server.pid")
echo "→ server  pid=$SERVER_PID  log=$RUN_DIR/server.log"

cd "$ROOT/web"
nohup npm run dev > "$RUN_DIR/web.log" 2>&1 &
echo $! > "$RUN_DIR/web.pid"
WEB_PID=$(cat "$RUN_DIR/web.pid")
echo "→ web     pid=$WEB_PID  log=$RUN_DIR/web.log"

wait_for() {
  local label=$1 url=$2 tries=$3
  local i=0
  while (( i < tries )); do
    if curl -sf "$url" >/dev/null 2>&1; then
      echo "✓ $label up"
      return 0
    fi
    sleep 0.5
    ((i++))
  done
  echo "△ $label did not become healthy within ${tries}×0.5s"
  return 1
}

echo
SERVER_OK=0; WEB_OK=0
wait_for "server" "http://localhost:3001/api/health" 30 && SERVER_OK=1 || true
wait_for "web   " "http://localhost:5173/"          30 && WEB_OK=1    || true

echo
if (( SERVER_OK && WEB_OK )); then
  echo "✓ MAFT up — open http://localhost:5173"
  echo "  tail -f $RUN_DIR/server.log"
  echo "  tail -f $RUN_DIR/web.log"
else
  echo "△ MAFT partially up — inspect logs in $RUN_DIR/ then run dev-down.sh"
  exit 1
fi
