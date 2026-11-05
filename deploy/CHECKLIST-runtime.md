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
| 3 | Secret `HUB_KUBECONFIG` (или `VK_KUBECONFIG`) в GitHub `4lesandr/FM-AI-Hub` | Александр (копия с FVKS) | open |
| 4 | Cutover-план FMAH→Sim | CTO | **готово** `deploy/CUTOVER-fmah-to-sim.md` |
| 5 | DNS + Keycloak + Sim `hub-secrets` | Александр / админ | open |
| 6 | Dry-run кнопки; затем uninstall FMAH + apply Sim | по команде «погнали» | open |
| 7 | Egress к моделям (amnezia), если 403 | ops | open |
| 8 | Verify: health, SSO, websocket, бренд | ops | open |
| 9 | Invite первых пользователей | Александр | open |

## Не делать на Air

type-check / turbo / full next build. Артефакт: `BUILD_ID=qYe2j_9dW8uBe6t4XPi2L`.
