#!/usr/bin/env bash
# Live smoke for FVKS token-exchange on localdev.
# Secrets → apps/sim/.env.local (localdev-fvks-env-from-contour.sh). Never echoes secrets/tokens.
#
# Usage:
#   SUBJECT_TOKEN='…' bash deploy/bin/localdev-fvks-smoke.sh
#   COOKIE='better-auth.session_token=…' SUBJECT_TOKEN='…' bash deploy/bin/localdev-fvks-smoke.sh
#
# If .next predates /api/fvks/connect (404), falls back to bun → lib/fvks (same exchange path).
set -euo pipefail
export PATH="${HOME}/.bun/bin:${PATH}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
ENV_LOCAL="$ROOT/apps/sim/.env.local"
SIM="$ROOT/apps/sim"

need_keys=(
  HUB_OIDC_ISSUER HUB_OIDC_CLIENT_ID HUB_OIDC_CLIENT_SECRET HUB_IDP_AUDIENCES
  FVKS_MCP_URL FVKS_MCP_CLIENT_ID FVKS_MCP_CLIENT_SECRET
)

echo "== env keys in .env.local =="
python3 - "$ENV_LOCAL" "${need_keys[@]}" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
need = sys.argv[2:]
keys = set()
if path.exists():
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        if v.strip():
            keys.add(k.strip())
missing = [k for k in need if k not in keys]
for k in need:
    print(f"  {k}: {'OK' if k in keys else 'MISSING'}")
if missing:
    raise SystemExit("fill secrets first: bash deploy/bin/localdev-fvks-env-from-contour.sh")
PY

echo "== localdev =="
code="$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/" || true)"
echo "  GET / → HTTP $code"
case "$code" in
  200|307|302|308) ;;
  *) echo "app not up — bash deploy/bin/localdev-up.sh" >&2; exit 1 ;;
esac

api_code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/api/fvks/connect" -H 'content-type: application/json' -d '{}' || true)"
echo "  POST /api/fvks/connect (anon probe) → HTTP $api_code"

if [[ -z "${SUBJECT_TOKEN:-}" && -z "${COOKIE:-}" ]]; then
  cat <<'EOF'
== auth needed ==
Fresh Keycloak access token required (FMAH account tokens on contour are expired).

  SUBJECT_TOKEN   Keycloak access (DevTools after login to FMAH hub / realm fteam)
  COOKIE          optional Sim session; required for HTTP path without bun fallback

SSO → account.accessToken (long-term):
  SSO_ENABLED + SSO_* same issuer, dedicated client with localhost redirect,
  HUB_OIDC_PROVIDER_ID=keycloak, sign in at http://localhost:3000 — then COOKIE=…

Example:
  SUBJECT_TOKEN='…' bash deploy/bin/localdev-fvks-smoke.sh
EOF
  exit 2
fi

smoke_via_http() {
  echo "== HTTP POST /api/fvks/connect =="
  local args=(-sS -X POST "$BASE_URL/api/fvks/connect" -H 'content-type: application/json')
  local body='{}'
  if [[ -n "${SUBJECT_TOKEN:-}" ]]; then
    body="$(SUBJECT_TOKEN="$SUBJECT_TOKEN" python3 -c 'import json,os; print(json.dumps({"subject_token": os.environ["SUBJECT_TOKEN"]}))')"
  fi
  if [[ -n "${COOKIE:-}" ]]; then
    args+=(-H "cookie: $COOKIE")
  else
    # ensure session so route accepts the call
    email="fvks-smoke-$(date +%s)@localhost.local"
    jar="$(mktemp)"
    curl -sS -c "$jar" -o /dev/null -X POST "$BASE_URL/api/auth/sign-up/email" \
      -H 'content-type: application/json' \
      -d "{\"email\":\"$email\",\"password\":\"SmokeTest!23456\",\"name\":\"FVKS Smoke\"}" >/dev/null
    cookie="$(awk '$6=="better-auth.session_token"{print $6"="$7}' "$jar" 2>/dev/null || true)"
    rm -f "$jar"
    if [[ -z "$cookie" ]]; then
      echo "could not obtain session cookie via sign-up" >&2
      return 1
    fi
    args+=(-H "cookie: $cookie")
  fi
  local resp
  resp="$(curl "${args[@]}" -d "$body" || true)"
  printf '%s' "$resp" | python3 -c '
import json,sys
raw=sys.stdin.read()
try:
  d=json.loads(raw)
except Exception:
  print("non-json:", raw[:200]); raise SystemExit(1)
if d.get("error") == "Not found":
  raise SystemExit(44)
conn=d.get("connection") or {}
grant=conn.get("grant_id") or ""
print("ok=", d.get("ok"), "error=", d.get("error"))
print("grant_id_prefix=", (grant[:12]+"…") if grant else None, "grant_id_len=", len(grant) or 0)
print("mcp_url=", conn.get("mcp_url"))
if not grant:
  raise SystemExit("smoke failed: no grant_id")
print("SMOKE OK (http)")
'
}

smoke_via_bun() {
  echo "== bun lib/fvks exchange (HTTP route absent in .next) =="
  if [[ -z "${SUBJECT_TOKEN:-}" ]]; then
    echo "SUBJECT_TOKEN required for bun fallback" >&2
    return 1
  fi
  (
    cd "$SIM"
    set -a
    # shellcheck disable=SC1091
    source .env.local
    set +a
    SUBJECT_TOKEN="$SUBJECT_TOKEN" bun -e '
import { exchangeAndMintFvksTokens, parseIdpAudiences } from "./lib/fvks/token-exchange.ts";
const audience = parseIdpAudiences().get("fvks");
if (!audience) throw new Error("HUB_IDP_AUDIENCES missing fvks=");
const subjectToken = process.env.SUBJECT_TOKEN;
if (!subjectToken) throw new Error("SUBJECT_TOKEN missing");
const mcpUrl = process.env.FVKS_MCP_URL;
if (!mcpUrl) throw new Error("FVKS_MCP_URL missing");
const tokens = await exchangeAndMintFvksTokens({
  subjectToken,
  audience,
  connectorSlug: "fvks",
  mcpUrl,
});
const grant = tokens.grant_id || "";
console.log(JSON.stringify({
  ok: true,
  grant_id_len: grant.length,
  grant_id_prefix: grant ? grant.slice(0, 12) + "…" : null,
  has_access: Boolean(tokens.access_token),
  mcp_url: tokens.mcp_url,
  acquired_via: tokens.acquired_via,
}));
if (!grant) process.exit(1);
console.log("SMOKE OK (bun lib)");
'
  )
}

if [[ "$api_code" == "404" ]]; then
  echo "note: .next BUILD_ID lacks /api/fvks/connect — using bun lib smoke; rebuild on Modal to enable curl path"
  smoke_via_bun
else
  set +e
  smoke_via_http
  rc=$?
  set -e
  if [[ $rc -eq 44 ]]; then
    smoke_via_bun
  elif [[ $rc -ne 0 ]]; then
    exit "$rc"
  fi
fi
