#!/usr/bin/env bash
# Thin wrapper: sync terraform vk-dev outputs → fmah-builder.state
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
exec bash "$ROOT/terraform/vk-dev/scripts/sync-builder-state.sh"
