# Deploy — FM AI Hub (FLOMNI)

Продукт: **FM AI Hub** · URL: `https://hub.fm.flomni.ru` · ns: `hub` (кластер Встреч).

Репо: `github.com/4lesandr/FM-AI-Hub` · ветка работы: `feat/fm-mvp`.

## Уже решено

- k8s рядом с meet, не VM хаба
- White-label: `NEXT_PUBLIC_BRAND_NAME=FM AI Hub`
- Тяжёлые сборки — Modal; локальный type-check на Air запрещён
- Next-артефакт: `BUILD_ID=qYe2j_9dW8uBe6t4XPi2L` (`apps/sim/.next`, `stand/artifacts/sim-next-build.tgz`)

## Структура

```
deploy/
  README.md
  tenants/flomni.yaml       # контур / OIDC заметки
  helm/values-flomni.yaml   # overlay на helm/sim
  terraform/vk-dev/         # VK warm(STD3-4-16) + CI builder (IaC)
  bin/vk_build_artifact.sh  # Gate C кнопка/ops
  bin/vk_deploy_dev.sh      # warm next start (ACK_MANUAL_UP)
  bin/vk_tf_sync_state.sh   # TF outputs → fmah-builder.state
```

Чарт: `helm/sim` в корне репо.

## VK warm / CI (IaC)

Locked 2026-11-07: warm **STD3-4-16** только ручной up→down; CI **STD3-16-32** (fallback 32-64).  
Docs: [`terraform/vk-dev/README.md`](terraform/vk-dev/README.md).  
Actions: **Build VK artifact (manual)**, **Deploy-dev VK (manual)** — не auto на push.  
Prod promote: **Deploy hub (manual)** тем же `gitSha`.

## Порядок выкладки (/2)

Как FVKS/`fvcs`: **push + кнопка** `Deploy hub (manual)`, не kubectl с ноутбука.

1. В GitHub secrets репо: `HUB_KUBECONFIG` (или тот же `VK_KUBECONFIG`, что у FVKS `deploy-vk`)
2. DNS `hub.fm.flomni.ru` → ingress кластера
3. Keycloak client в `fteam` (redirect под Sim SSO; не ломать VM `hub` до cutover)
4. Один раз: Secret `hub-secrets` в ns `hub` (через ту же кнопку с apply или уже существующий ops-канал)
5. Actions → **Deploy hub (manual)** → сначала `dry_run=true`, потом `false`
6. Включить SSO_* после IdP
7. Verify: health, SSO, websocket, бренд; invite

Скрипт: `deploy/bin/ci_deploy_hub.sh` · values: `deploy/helm/values-flomni.yaml`  
Cutover FMAH→Sim: [`CUTOVER-fmah-to-sim.md`](CUTOVER-fmah-to-sim.md) (ns `hub` сейчас занят `hub-tenant`).

## Localdev (/2b)

Лёгкий стенд на готовом `.next` (без turbo/tsc и без full rebuild): [`LOCALDEV.md`](LOCALDEV.md) · `deploy/bin/localdev-up.sh`.

## Mac

Не запускать `bun run type-check` / `turbo type-check` локально. Push: `HUSKY=0 git push` если хук тянет type-check.
