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
| OIDC client secret | после клиента Keycloak `fteam` |

Создание (из CI/ops с kubeconfig, не с Air без API):

```bash
kubectl -n hub create secret generic hub-secrets --from-env-file=hub-secrets.env
```
