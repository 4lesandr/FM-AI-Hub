# Cutover: FMAH (hub-tenant) → FM AI Hub (Sim)

**Решение (2026-11-05):** готовим замену в ns `hub`. Apply/uninstall — только по явной команде после чеклиста.

## As-is (VK, проверено)

| | |
| --- | --- |
| Кластер | VK (`95.163.181.5:6443`), тот же что meet/fvcs |
| ns | `hub` |
| Helm release | `hub` · chart `hub-tenant-0.1.0` · rev 22 |
| Ingress | `hub.hidden-route.com` |
| Workloads | `frontend`, `hub-api`, `hub-live`, `hub-worker` |
| Secret | `hub-secrets` (FMAH keys — **пересобрать** под Sim) |

## To-be

| | |
| --- | --- |
| Product | FM AI Hub (Sim fork) |
| Release | `fm-ai-hub` · chart `helm/sim` · `-f deploy/helm/values-flomni.yaml` |
| URL | `https://hub.fm.flomni.ru` |
| CI | Actions **Deploy hub (manual)** · secrets `HUB_KUBECONFIG`/`VK_KUBECONFIG` уже в `4lesandr/FM-AI-Hub` |

## Чеклист (порядок)

1. **DNS** `hub.fm.flomni.ru` → `138.16.207.76` (ingress-nginx EXTERNAL-IP), без CF proxy
2. **Keycloak** клиент `fteam` + redirect Sim callback (не ломать старый, пока FMAH жив)
3. **Пересобрать** `hub-secrets` под Sim (`BETTER_AUTH_SECRET`, `ENCRYPTION_KEY`, … — сейчас в секрете ключи FMAH: `HUB_KEK`/`HUB_APP_KEYS`, для Sim не подойдут). Бэкап: `kubectl -n hub get secret hub-secrets -o yaml > hub-secrets-fmah.backup.yaml` (локально, не в git). Включить `FVKS_EVENTS_TOKEN` (+ опц. signing) — см. `docs/deploy/fvks-events-url-cutover.md`
4. Secret GitHub `HUB_POSTGRES_PASSWORD` (для bundled PG в чарте Sim)
5. **Dry-run** Sim: `Deploy hub` `dry_run=true` (скрипт откажется apply, пока жив release `hub`)
6. **Окно cutover** (только после «погнали»)
   - `helm -n hub uninstall hub` (FMAH `hub-tenant`)
   - убедиться: нет deploy/ingress старого хаба
   - `Deploy hub` `dry_run=false` → release `fm-ai-hub`
   - **FVKS events:** переписать `FVKS_MCP_HUB_EVENTS_URL` на `https://hub.fm.flomni.ru/api/webhooks/fvks/<token>` (не `AGENT_HUB_*`)
7. **Verify:** TLS, health, SSO, websocket, бренд «FM AI Hub», push-событие FVKS → workflow
8. **Invite** сотрудников; старый `hub.hidden-route.com` снять/редирект по решению

## Явно не делать сейчас

- `helm uninstall` / apply без отдельного «погнали» в чате
- Локальный type-check / rebuild next на Air
