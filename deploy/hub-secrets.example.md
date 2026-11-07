# Secret `hub-secrets` (ns `hub`)

Нужен до `Deploy hub` с `dry_run=false`. Значения **не** коммитить.

Минимум (имена ключей как в `helm/sim`):

| Key | Заметка |
| --- | --- |
| `BETTER_AUTH_SECRET` | обязательно |
| `ENCRYPTION_KEY` | обязательно (длинный hex; см. чарт) |
| `INTERNAL_API_SECRET` | если чарт/прокси требует |
| `DATABASE_URL` / postgres keys | по values stateful |
| `REDIS_URL` | по values |
| OIDC / SSO client secret | после клиента Keycloak (`fteam` / hub) |
| `HUB_OIDC_ISSUER` | realm issuer (Flomni: `auth.flomni.com/realms/fteam`; или `SSO_ISSUER`) |
| `HUB_OIDC_CLIENT_ID` / `HUB_OIDC_CLIENT_SECRET` | клиент с token-exchange (secret ← FMAH `hub-secrets`) |
| `HUB_IDP_AUDIENCES` | например `fvks=meet` |
| `FVKS_MCP_URL` | MCP Встреч (`meet.fm.flomni.ru/mcp`) |
| `FVKS_MCP_CLIENT_ID` / `FVKS_MCP_CLIENT_SECRET` | preregistered Hub client у FVKS (FMAH connector / `fvks_pairs`) |
| `FVKS_EVENTS_TOKEN` / `FVKS_EVENTS_SIGNING_SECRET` | ingress событий |
| `HUB_APP_KEYS` | Agents API для панели Встреч: `fvks:<секрет≥32>` (тот же секрет, что `AGENT_HUB_SECRET` у FVKS) |

Localdev sync без печати значений: `deploy/bin/localdev-fvks-env-from-contour.sh` → `apps/sim/.env.local` (см. `LOCALDEV.md`).

Создание (из CI/ops с kubeconfig, не с Air без API):

```bash
kubectl -n hub create secret generic hub-secrets --from-env-file=hub-secrets.env
```

## Self-host Chat (FM AI Hub)

На контуре без mothership Copilot:

```bash
NEXT_PUBLIC_CHAT_DISABLED=true
```

Иначе workspace Home ходит в mothership → Unauthorized. Свой чат — Installation pane в `/workspace/{id}/apps`.
