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
| `HUB_OIDC_ISSUER` | realm issuer (или полагаться на `SSO_ISSUER`) |
| `HUB_OIDC_CLIENT_ID` / `HUB_OIDC_CLIENT_SECRET` | клиент с token-exchange |
| `HUB_IDP_AUDIENCES` | например `fvks=meet` |
| `FVKS_MCP_URL` | MCP Встреч |
| `FVKS_MCP_CLIENT_ID` / `FVKS_MCP_CLIENT_SECRET` | preregistered Hub client у FVKS |
| `FVKS_EVENTS_TOKEN` / `FVKS_EVENTS_SIGNING_SECRET` | ingress событий |

Создание (из CI/ops с kubeconfig, не с Air без API):

```bash
kubectl -n hub create secret generic hub-secrets --from-env-file=hub-secrets.env
```
