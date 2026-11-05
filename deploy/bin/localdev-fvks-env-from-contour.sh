#!/usr/bin/env bash
# Pull HUB_OIDC_* / FVKS_MCP_* for localdev from live FMAH contour (ns hub + meet).
# Values are written to apps/sim/.env.local only — never printed. Requires kubectl (+ helm for mcpClientId fallback).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_LOCAL="${ROOT}/apps/sim/.env.local"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
umask 077
: >"$TMP"

NS_HUB="${NS_HUB:-hub}"
NS_MEET="${NS_MEET:-meet}"
HELM_MEET="${HELM_MEET:-meet}"

need() { command -v "$1" >/dev/null || { echo "missing $1" >&2; exit 1; }; }
need kubectl
need python3

python3 - "$NS_HUB" "$TMP" <<'PY'
import json, subprocess, sys
ns, path = sys.argv[1], sys.argv[2]
d = json.loads(subprocess.check_output(["kubectl", "-n", ns, "get", "deploy", "hub-api", "-o", "json"]))
want = ["HUB_OIDC_ISSUER", "HUB_OIDC_CLIENT_ID", "HUB_IDP_AUDIENCES", "FVKS_MCP_URL"]
vals = {
    "HUB_OIDC_ISSUER": "https://auth.flomni.com/realms/fteam",
    "HUB_OIDC_CLIENT_ID": "hub",
    "HUB_IDP_AUDIENCES": "fvks=meet",
    "FVKS_MCP_URL": "https://meet.fm.flomni.ru/mcp",
    "HUB_OIDC_PROVIDER_ID": "keycloak",
}
for c in d["spec"]["template"]["spec"]["containers"]:
    for e in c.get("env") or []:
        if e.get("name") in want and "value" in e and e["value"]:
            vals[e["name"]] = e["value"]
with open(path, "a") as f:
    for k, v in vals.items():
        f.write(f"{k}={v}\n")
print("public:", ",".join(sorted(vals)))
PY

python3 - "$NS_HUB" "$TMP" <<'PY'
import base64, json, subprocess, sys
ns, path = sys.argv[1], sys.argv[2]
raw = json.loads(subprocess.check_output(["kubectl", "-n", ns, "get", "secret", "hub-secrets", "-o", "json"]))
sec = base64.b64decode(raw["data"]["HUB_OIDC_CLIENT_SECRET"]).decode()
with open(path, "a") as f:
    f.write(f"HUB_OIDC_CLIENT_SECRET={sec}\n")
print("HUB_OIDC_CLIENT_SECRET: SET len=", len(sec))
PY

# Prefer connector decrypt in hub-api (source of truth for jwt-bearer client).
POD="$(kubectl -n "$NS_HUB" get pods -o name | grep hub-api | head -1 | sed 's|pod/||')"
test -n "$POD"
EXTRACT="$(mktemp)"
cat >"$EXTRACT" <<'JS'
const { createDataSource } = require('/app/packages/db/dist/data-source.js');
const { Connector } = require('/app/packages/db/dist/entities/connector.js');
const { SecretBox } = require('/app/packages/db/dist/crypto.js');
const fs = require('fs');
(async () => {
  const ds = createDataSource();
  await ds.initialize();
  try {
    const c = await ds.getRepository(Connector).findOne({ where: { slug: 'fvks', isEnabled: true } });
    if (!c?.oauthClientId || !c.oauthClientSecretEnc || !c.oauthClientKeyVersion) {
      throw new Error('fvks connector missing oauth client');
    }
    const secret = SecretBox.fromEnv().decryptString(c.oauthClientSecretEnc, c.oauthClientKeyVersion);
    fs.writeFileSync('/tmp/fvks-mcp-client.json', JSON.stringify({
      client_id: c.oauthClientId,
      client_secret: secret,
      mcp_url: c.mcpUrl,
    }), { mode: 0o600 });
    console.log(JSON.stringify({
      ok: true,
      client_id_len: c.oauthClientId.length,
      client_id_prefix: c.oauthClientId.slice(0, 6),
      secret_len: secret.length,
    }));
  } finally {
    await ds.destroy();
  }
})().catch((e) => { console.error(String(e && e.stack || e)); process.exit(1); });
JS
kubectl -n "$NS_HUB" cp "$EXTRACT" "$POD:/tmp/extract-mcp-client.cjs"
rm -f "$EXTRACT"
kubectl -n "$NS_HUB" exec "$POD" -- node /tmp/extract-mcp-client.cjs
LOCAL_JSON="$(mktemp)"
kubectl -n "$NS_HUB" cp "$POD:/tmp/fvks-mcp-client.json" "$LOCAL_JSON"
python3 - "$LOCAL_JSON" "$TMP" <<'PY'
import json, sys
src, path = sys.argv[1], sys.argv[2]
d = json.load(open(src))
with open(path, "a") as f:
    f.write(f"FVKS_MCP_CLIENT_ID={d['client_id']}\n")
    f.write(f"FVKS_MCP_CLIENT_SECRET={d['client_secret']}\n")
print("FVKS_MCP_CLIENT_*: SET id_len=", len(d["client_id"]), "secret_len=", len(d["client_secret"]))
PY
rm -f "$LOCAL_JSON"
kubectl -n "$NS_HUB" exec "$POD" -- rm -f /tmp/fvks-mcp-client.json /tmp/extract-mcp-client.cjs >/dev/null 2>&1 || true

python3 - "$TMP" "$ENV_LOCAL" <<'PY'
from pathlib import Path
import sys
src, dest = Path(sys.argv[1]), Path(sys.argv[2])
incoming = {}
for line in src.read_text().splitlines():
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    incoming[k] = v
text = dest.read_text() if dest.exists() else ""
out, seen = [], set()
for line in text.splitlines():
    if "=" in line and not line.strip().startswith("#"):
        k = line.split("=", 1)[0].strip()
        if k in incoming:
            out.append(f"{k}={incoming[k]}")
            seen.add(k)
            continue
    out.append(line)
if out and out[-1].strip():
    out.append("")
out.append("# /2c2 FVKS token-exchange (from FMAH contour — do not commit)")
for k, v in incoming.items():
    if k not in seen:
        out.append(f"{k}={v}")
dest.write_text("\n".join(out) + "\n")
dest.chmod(0o600)
print("upserted", ",".join(sorted(incoming)), "→", dest)
print("restart localdev (bash deploy/bin/localdev-down.sh && bash deploy/bin/localdev-up.sh) to load env")
PY
