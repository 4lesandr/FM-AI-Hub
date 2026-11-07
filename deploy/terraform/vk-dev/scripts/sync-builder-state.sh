#!/usr/bin/env bash
# Write TF outputs into ~/.config/vkcloud/fmah-builder.state (preserve GIT_SHA/BUILD_ID).
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
STATE=${STATE_FILE:-$HOME/.config/vkcloud/fmah-builder.state}
cd "$ROOT"

need() { command -v "$1" >/dev/null || { echo "need $1"; exit 1; }; }
need terraform
need jq

json=$(terraform output -json)
SERVER_ID=$(jq -r '.server_id.value // empty' <<<"$json")
VOLUME_ID=$(jq -r '.volume_id.value // empty' <<<"$json")
IP=$(jq -r '.ip.value // empty' <<<"$json")
FLAVOR=$(jq -r '.flavor.value // empty' <<<"$json")

GIT_SHA=""; BUILD_ID=""; PURPOSE=""; SESSION_STARTED_AT=""
if [[ -f "$STATE" ]]; then
  # shellcheck disable=SC1090
  source "$STATE"
fi

umask 077
cat >"$STATE" <<EOF
SERVER_ID=${SERVER_ID}
VOLUME_ID=${VOLUME_ID}
IP=${IP}
GIT_SHA=${GIT_SHA:-}
BUILD_ID=${BUILD_ID:-}
PURPOSE=${PURPOSE:-}
FLAVOR_IN_USE=${FLAVOR_IN_USE:-$FLAVOR}
SESSION_STARTED_AT=${SESSION_STARTED_AT:-}
UPDATED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
TF_SYNCED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
echo "wrote $STATE"
echo "server=$SERVER_ID volume=$VOLUME_ID ip=$IP flavor=$FLAVOR"
