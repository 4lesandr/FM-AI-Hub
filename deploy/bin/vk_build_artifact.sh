#!/usr/bin/env bash
# Gate C: build artifact for one SHA on VK builder (manual / workflow_dispatch).
# Does NOT destroy. Prefer down after seal.
#
# Env:
#   GIT_SHA / REF — optional pin (default: current HEAD of REPO)
#   PURPOSE=ci FLAVOR=STD3-16-32 — passed to up.sh
#   FLAVOR_FALLBACK=STD3-32-64 — documented; set FLAVOR explicitly to use
set -euo pipefail

CONF=${FMAH_BUILDER_CONF:-$HOME/.config/vkcloud}
REPO=${REPO:-$HOME/Documents/XSiva/sim-sandbox-fm-mvp}
REF=${REF:-${GIT_SHA:-}}

PURPOSE=${PURPOSE:-ci}
export PURPOSE
if [[ -z "${FLAVOR:-}" ]]; then
  # shellcheck disable=SC1091
  source "$CONF/fmah-builder.env"
  export FLAVOR=${FLAVOR_CI:-STD3-16-32}
fi

echo "vk_build_artifact purpose=$PURPOSE flavor=$FLAVOR repo=$REPO ref=${REF:-HEAD}"

# Pin SHA into LaunchAgent-readable cache
if [[ -n "$REF" ]]; then
  git -C "$REPO" rev-parse --verify "$REF^{commit}" >/dev/null
  SHA=$(git -C "$REPO" rev-parse "$REF^{commit}")
  BRANCH=$(git -C "$REPO" rev-parse --abbrev-ref HEAD)
  DST=${DST:-$HOME/.cache/fm-ai-hub-src}
  SRC=$REPO REF=$SHA bash -c '
    SRC="$0"; DST="$1"; SHA="$2"; BRANCH="$3"
    mkdir -p "$DST"
    rsync -a --delete \
      --exclude .git --exclude node_modules --exclude "**/.next" \
      --exclude "**/dist" --exclude .turbo --exclude stand/artifacts \
      "$SRC"/ "$DST"/
    printf "%s\n" "$SHA" >"$DST/.build-sha"
    printf "%s\n" "$BRANCH" >"$DST/.build-branch"
    echo "DST_SHA=$SHA"
  ' "$REPO" "$DST" "$SHA" "$BRANCH"
else
  bash "$CONF/fmah-builder-sync-src.sh"
fi

bash "$CONF/fmah-builder-build.sh"

# Fail closed: manifest must match requested SHA when pin set
if [[ -n "${SHA:-}" ]]; then
  MAN=$HOME/.bb/skills/cto/notebook/artifacts/sim-next-${SHA}.manifest.json
  [[ -f "$MAN" ]] || { echo "FATAL: missing manifest $MAN"; exit 1; }
  msha=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["gitSha"])' "$MAN")
  [[ "$msha" == "$SHA" ]] || { echo "FATAL: manifest gitSha=$msha != $SHA"; exit 1; }
  bid=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["buildId"])' "$MAN")
  [[ -n "$bid" ]] || { echo "FATAL: empty buildId"; exit 1; }
  echo "PASS manifest $MAN buildId=$bid"
fi

echo "next: ~/.config/vkcloud/fmah-builder-down.sh  # keep volume; do not destroy"
