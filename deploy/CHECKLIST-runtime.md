# /2 Runtime checklist — FM AI Hub → FLOMNI

## Сделано в git (`feat/fm-mvp`)

- [x] Репо `4lesandr/FM-AI-Hub`
- [x] `deploy/tenants/flomni.yaml`
- [x] `deploy/helm/values-flomni.yaml` (overlay на `helm/sim`)
- [x] README порядка выкладки

## Нужно вне кода (исполнители)

| # | Что | Кто | Статус |
| --- | --- | --- | --- |
| 1 | DNS A/CNAME `hub.fm.flomni.ru` → ingress meet-кластера | админ / Александр | open |
| 2 | Keycloak client в `fteam` (SSO callback Sim; не ломать VM `hub` до cutover) | админ Keycloak | open |
| 3 | ns `hub` + secret `hub-secrets` | ops с `kfvks` | open |
| 4 | `helm upgrade --install` с values-flomni | ops | open |
| 5 | Egress к моделям (amnezia), если 403 | ops | open |
| 6 | Verify: health, SSO, websocket, бренд | ops | open |
| 7 | Invite первых пользователей | Александр | open |
| 8 | CI кнопка (workflow_dispatch), не auto-push | следующий коммит | open |

## Не делать на Air

type-check / turbo / full next build. Артефакт: `BUILD_ID=qYe2j_9dW8uBe6t4XPi2L`.
