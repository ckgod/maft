#!/usr/bin/env bash
# MAFT — stop backend and frontend dev servers started by dev-up.sh.
# Kills the PID tree saved by dev-up, then sweeps any leftover listener on the ports.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT/scripts/.run"

kill_tree() {
  local pid=$1
  [ -z "$pid" ] && return 0
  kill -0 "$pid" 2>/dev/null || return 0
  pkill -TERM -P "$pid" 2>/dev/null || true
  kill -TERM "$pid" 2>/dev/null || true
}

stop_pidfile() {
  local label=$1 file=$2
  if [ -f "$file" ]; then
    local pid
    pid=$(cat "$file" 2>/dev/null || true)
    if [ -n "$pid" ]; then
      echo "→ stopping $label (pid=$pid)"
      kill_tree "$pid"
    fi
    rm -f "$file"
  fi
}

stop_pidfile "server" "$RUN_DIR/server.pid"
stop_pidfile "web   " "$RUN_DIR/web.pid"

# Give children a moment to exit
sleep 1

sweep_port() {
  local port=$1
  local pids
  pids=$(lsof -ti:"$port" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "  port $port still occupied — SIGKILL: $pids"
    echo "$pids" | xargs kill -9 2>/dev/null || true
  fi
}

sweep_port 3001
sweep_port 5173

echo "✓ MAFT down"
