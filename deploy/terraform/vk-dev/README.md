# Terraform: VK warm/CI builder (FM AI Hub)

Канон infra-as-code под locked-модель **2026-11-07**:

| Роль | Flavor | Политика |
| --- | --- | --- |
| **dev** (default) | `STD3-4-16` | только ручной `up` → работа → `down` (SHUTOFF); disk sticky |
| **ci** | `STD3-16-32` (+ fallback `STD3-32-64` при OOM) | эфемерный job; после artifact — `down` |
| **prod** | k8s `hub` | не этот стек |

`role=dev|ci` — один стек, не две копии. Flavor в TF **не** форсит recreate (lifecycle ignore); смена flavor — осознанный recreate/resize **после** seal artifact.

## Не путать со старым FMAH TF

| | Старый FMAH | Этот модуль |
| --- | --- | --- |
| State key | `fmah/terraform.tfstate` | `fm-ai-hub/vk-dev/terraform.tfstate` |
| Bucket | `fmah-tfstate-vk` | тот же |
| Назначение | legacy hub VM | warm/CI builder FM AI Hub |

Секреты: `~/.config/vkcloud/fmah-tfstate.env` (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`). **Не коммитить.**

## Preconditions

```bash
source ~/.config/vkcloud/fmah-openrc.sh
set -a && source ~/.config/vkcloud/fmah-tfstate.env && set +a
cd deploy/terraform/vk-dev

# registry.terraform.io часто geo-block с RU — локальный mirror:
#   curl -sL -o /tmp/vkcs.zip \
#     https://github.com/vk-cs/terraform-provider-vkcs/releases/download/v0.19.0/terraform-provider-vkcs_0.19.0_darwin_arm64.zip
#   mkdir -p ~/.terraform.d/plugins/registry.terraform.io/vk-cs/vkcs/0.19.0/darwin_arm64
#   unzip -o /tmp/vkcs.zip -d ~/.terraform.d/plugins/registry.terraform.io/vk-cs/vkcs/0.19.0/darwin_arm64
cp .terraformrc.example .terraformrc   # gitignored; path уже $HOME
export TF_CLI_CONFIG_FILE=$PWD/.terraformrc

cp backend.hcl.example backend.hcl     # optional
terraform init -reconfigure -backend-config=backend.hcl.example \
  -plugin-dir="$HOME/.terraform.d/plugins"
terraform validate
```

Env для backend: **`AWS_ACCESS_KEY_ID`**, **`AWS_SECRET_ACCESS_KEY`** из `fmah-tfstate.env`.  
Env для provider: **`OS_*`** из `fmah-openrc.sh` (пароль — keychain).

## Import существующего ACTIVE/SHUTOFF (не destroy)

Текущий sticky builder (пример ids — сверяйте `fmah-builder.state`):

```bash
# Match live names/flavor so plan is clean
cp terraform.tfvars.example terraform.tfvars
# volume_name = "dev-fm-agenthub-boot-32"
# flavor_override = "STD3-32-64"   # while CI/fallback host is live

terraform import 'vkcs_blockstorage_volume.boot' 8d8e0504-b9fe-4872-ab73-7906d53a79a4
terraform import 'vkcs_compute_instance.this[0]' ede09090-1fee-4083-82fe-49b4e2252caa

terraform plan
# Цель: «No changes». Если plan хочет replace volume/instance — СТОП, не apply.
# На import sticky host lifecycle ignore_changes закрывает drift
# config_drive/block_device/source_type (иначе -/ + recreate).
```

Проверено 2026-11-07: import live `ede09090…` + vol `8d8e0504…` → **plan clean**, builder ACTIVE не тронут.

Скрипт-помощник: `./scripts/import-existing.sh`.

## stop ≠ destroy

| Действие | Команда | Биллинг |
| --- | --- | --- |
| Up (manual) | `~/.config/vkcloud/fmah-builder-up.sh` | compute ACTIVE |
| Down | `~/.config/vkcloud/fmah-builder-down.sh` | compute 0; disk+IP да |
| Idle warn | `fmah-builder-status.sh` → `WARN_IDLE_ACTIVE` ≥30м | — |
| Destroy | `fmah-builder-destroy.sh` / `terraform destroy` | **запрещено** пока artifact на VK volume / in-flight build |

Volume: `prevent_destroy = true`, `delete_on_termination = false`.

**Не** авто-cron wake в Terraform (только ручной up).

## Sync state → ops scripts

```bash
./scripts/sync-builder-state.sh
# пишет SERVER_ID/VOLUME_ID/IP в ~/.config/vkcloud/fmah-builder.state
```

Или: `deploy/bin/vk_tf_sync_state.sh`.

## CI / кнопки

- GitHub Actions: `.github/workflows/build-vk-artifact.yml` (`workflow_dispatch`)
- Deploy warm: `.github/workflows/deploy-dev-vk.yml` (`workflow_dispatch`)
- Promote prod: существующий `deploy-hub.yml` + `CUTOVER-runbook.md` (тот же `gitSha`)

Локальный канон сборки по-прежнему: `fmah-builder-sync-src.sh` → `fmah-builder-build.sh` → seal → **down**.

## Cost

- Warm 4-16 ~9,7 ₽/ч ACTIVE; SHUTOFF compute=0
- CI 16-32 ~28,8 ₽/ч только на job
- Disk 100G ceph-ssd ~1,3 тыс ₽/мес пока volume жив
- IDLE ACTIVE ≥30м без job = нарушение

## Empty path (новый стенд)

Без import: `terraform apply -var='role=dev'` создаст volume+instance на `internet` + SG `fmah-hub`/`default` + keypair `fmah-dev` + cloud-init. Затем `sync-builder-state.sh` и `fmah-builder-down.sh` после сессии.
