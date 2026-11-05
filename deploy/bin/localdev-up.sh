#!/usr/bin/env bash
# Light localdev: next start + realtime against existing .next / host DB.
# No turbo type-check, no next build.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export PATH="${HOME}/.bun/bin:${PATH}"
mkdir -p /tmp
LOG_NEXT=/tmp/sim-localdev-next.log
LOG_RT=/tmp/sim-localdev-realtime.log
PID_DIR="${TMPDIR:-/tmp}/sim-localdev"
mkdir -p "$PID_DIR"

if lsof -nP -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "port 3000 already in use"
else
  (
    cd "$ROOT/apps/sim"
    nohup bun run start >>"$LOG_NEXT" 2>&1 </dev/null &
    echo $! >"$PID_DIR/next.pid"
  )
  echo "next → http://localhost:3000 (log $LOG_NEXT)"
fi

if lsof -nP -iTCP:3002 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "port 3002 already in use"
else
  (
    set -a
    # shellcheck disable=SC1091
    source "$ROOT/apps/sim/.env.local"
    set +a
    cd "$ROOT/apps/realtime"
    nohup bun run start >>"$LOG_RT" 2>&1 </dev/null &
    echo $! >"$PID_DIR/realtime.pid"
  )
  echo "realtime → http://localhost:3002/health (log $LOG_RT)"
fi

sleep 2
curl -fsS -o /dev/null -w "app HTTP %{http_code}\n" http://127.0.0.1:3000/ || true
curl -fsS http://127.0.0.1:3002/health || true
echo
