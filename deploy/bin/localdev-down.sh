#!/usr/bin/env bash
set -euo pipefail
PID_DIR="${TMPDIR:-/tmp}/sim-localdev"

kill_port() {
  local port="$1"
  local pids
  pids="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    echo "stopped listeners on :$port ($pids)"
  else
    echo "nothing on :$port"
  fi
}

kill_port 3000
kill_port 3002
rm -f "$PID_DIR/next.pid" "$PID_DIR/realtime.pid" 2>/dev/null || true
