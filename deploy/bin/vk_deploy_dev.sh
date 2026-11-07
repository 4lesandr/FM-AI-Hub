#!/usr/bin/env bash
# Deploy-dev: ensure warm host up (manual ack) → unpack artifact → next start hint.
# Requires ACK_MANUAL_UP=1 to actually start compute (no auto-wake policy).
set -euo pipefail
CONF=${FMAH_BUILDER_CONF:-$HOME/.config/vkcloud}
# shellcheck disable=SC1091
source "$CONF/fmah-builder-lib.sh"
fmah_state_load

GIT_SHA=${GIT_SHA:?set GIT_SHA}
REMOTE_DIR=${REMOTE_DIR:-/opt/fm-ai-hub}
REMOTE_ART=$REMOTE_DIR/stand/artifacts/sim-next-${GIT_SHA}.tgz

if [[ "${ACK_MANUAL_UP:-0}" != "1" ]]; then
  cat <<EOF
REFUSE: warm up is manual-only.
  1) ACK_MANUAL_UP=1 PURPOSE=dev FLAVOR=\${FLAVOR_DEV:-STD3-4-16} $CONF/fmah-builder-up.sh
  2) ACK_MANUAL_UP=1 GIT_SHA=$GIT_SHA $0
Or status: $CONF/fmah-builder-status.sh
EOF
  exit 2
fi

export PURPOSE=${PURPOSE:-dev}
export FLAVOR=${FLAVOR:-${FLAVOR_DEV:-STD3-4-16}}
bash "$CONF/fmah-builder-up.sh"
fmah_state_load
[[ -n "${IP:-}" ]] || { echo "FATAL: no IP"; exit 1; }

fmah_ssh "$IP" "test -f $REMOTE_ART" || {
  echo "FATAL: missing $REMOTE_ART on VK volume — build/seal first"
  exit 1
}

fmah_ssh "$IP" "bash -s" <<REMOTE
set -euo pipefail
export PATH="\$HOME/.bun/bin:/usr/local/bin:\$PATH"
cd $REMOTE_DIR/apps/sim
tar -xzf $REMOTE_ART
BID=\$(cat .next/BUILD_ID)
echo "BUILD_ID=\$BID"
echo "hint: cd $REMOTE_DIR/apps/sim && bunx next start -H 0.0.0.0 -p 3000"
echo "URL: http://$IP:3000  (ensure SG/caddy as needed)"
REMOTE

echo "ip=$IP sha=$GIT_SHA"
echo "when done: $CONF/fmah-builder-down.sh"
