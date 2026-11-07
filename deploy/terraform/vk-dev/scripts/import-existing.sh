#!/usr/bin/env bash
# Import live sticky builder into this module. NEVER destroy.
# Usage:
#   SERVER_ID=... VOLUME_ID=... ./scripts/import-existing.sh
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

STATE=${STATE_FILE:-$HOME/.config/vkcloud/fmah-builder.state}
if [[ -f "$STATE" ]]; then
  # shellcheck disable=SC1090
  source "$STATE"
fi

SERVER_ID=${SERVER_ID:?set SERVER_ID or have it in fmah-builder.state}
VOLUME_ID=${VOLUME_ID:?set VOLUME_ID or have it in fmah-builder.state}

echo "import volume $VOLUME_ID"
terraform import 'vkcs_blockstorage_volume.boot' "$VOLUME_ID"
echo "import server $SERVER_ID"
terraform import 'vkcs_compute_instance.this[0]' "$SERVER_ID"
echo "next: terraform plan  # must be non-destructive"
