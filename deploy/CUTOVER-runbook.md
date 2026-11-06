# Cutover runbook — FMAH → FM AI Hub (Sim)

**Карточка `/2f`.** Единый ops-чеклист подготовки.  
**Скоп:** порядок шагов, verify, rollback.  
**Вне скопа:** `helm uninstall` / `kubectl apply` / Deploy hub `dry_run=false` — только после явного «погнали» (см. `deploy/CUTOVER-fmah-to-sim.md`).

Секреты и значения токенов в чат/git **не** класть — только имена ключей.

Источники: `CUTOVER-fmah-to-sim.md`, `docs/deploy/fvks-events-url-cutover.md`, `docs/deploy/agents-api-meet-cutover.md`, `docs/deploy/token-exchange-fvks-mcp.md`, `deploy/LOCALDEV.md` (§ FVKS smoke).

---

## 0. Предусловия (до окна)

| # | Что | Done? |
| --- | --- | --- |
| 0.1 | Паритет функций закрыт в review: `/2a` map, `/2c` exchange+MCP, `/2c2` live smoke, `/2d` events, `/2e` Agents API | ☐ |
| 0.2 | Репо `4lesandr/FM-AI-Hub` · ветка `feat/fm-mvp` · chart `helm/sim` + `deploy/helm/values-flomni.yaml` | ☐ |
| 0.3 | GitHub secrets: `HUB_KUBECONFIG` / `VK_KUBECONFIG`, `HUB_POSTGRES_PASSWORD` | ☐ |
| 0.4 | DNS `hub.fm.flomni.ru` → `138.16.207.76` (ingress-nginx EXTERNAL-IP), **без** CF proxy | ☐ |
| 0.5 | Keycloak `fteam`: клиент/redirect под Sim callback; **старый FMAH client не ломать** | ☐ |
| 0.6 | Localdev smoke зелёный (раздел 2) | ☐ |
| 0.7 | Dry-run CI: Actions **Deploy hub** `dry_run=true` (скрипт откажется apply, пока жив release `hub`) | ☐ |
| 0.8 | Hub env: `ORG_REVOKE_PERSONAL_KEYS_ON_LEAVE=true` в `values-flomni` / tenant / `.env.example` (leave burns personal keys) | ☐ |

As-is FMAH (VK, ns `hub`): release `hub` · chart `hub-tenant` · ingress `hub.hidden-route.com`.  
To-be: release `fm-ai-hub` · URL `https://hub.fm.flomni.ru`.

---

## 1. Секреты Sim (`hub-secrets`) — подготовка, не apply

Бэкап FMAH (локально, не в git):

```bash
kubectl -n hub get secret hub-secrets -o yaml > hub-secrets-fmah.backup.yaml
```

Пересобрать ключи под Sim (имена — `deploy/hub-secrets.example.md`):

| Группа | Ключи |
| --- | --- |
| Core Sim | `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY`, (+ `INTERNAL_API_SECRET` если нужен) |
| Data | `DATABASE_URL` / postgres · `REDIS_URL` — по values |
| Token-exchange `/2c` | `HUB_OIDC_ISSUER`, `HUB_OIDC_CLIENT_ID`, `HUB_OIDC_CLIENT_SECRET`, `HUB_OIDC_PROVIDER_ID`, `HUB_IDP_AUDIENCES` (`fvks=meet`) |
| MCP | `FVKS_MCP_URL`, `FVKS_MCP_CLIENT_ID`, `FVKS_MCP_CLIENT_SECRET`, опц. `FVKS_MCP_TOKEN_URL` |
| Events `/2d` | `FVKS_EVENTS_TOKEN` (≥16), опц. `FVKS_EVENTS_SIGNING_SECRET` |
| Agents API `/2e` | `HUB_APP_KEYS=fvks:<секрет≥32>` (= meet `AGENT_HUB_SECRET`) |

FMAH-only ключи (`HUB_KEK`, старые `HUB_APP_KEYS` формата FMAH) **не** подходят как Sim core — пересобрать.  
Значение `HUB_APP_KEYS` / `AGENT_HUB_SECRET` для панели можно перенести 1:1 (формат `fvks:…`).

Создание secret в кластере — **не в этом runbook** (ждёт «погнали»).

---

## 2. Localdev smoke (до prod URL)

Стенд: `deploy/LOCALDEV.md` · `bash deploy/bin/localdev-up.sh` (готовое `.next`, без type-check на Air).

### 2a. Token-exchange + MCP (`SUBJECT_TOKEN`)

```bash
bash deploy/bin/localdev-fvks-env-from-contour.sh   # upsert .env.local, без echo значений
bash deploy/bin/localdev-down.sh && bash deploy/bin/localdev-up.sh

# свежий Keycloak access (DevTools после входа в FMAH / Keycloak; не в git)
SUBJECT_TOKEN='…' bash deploy/bin/localdev-fvks-smoke.sh
```

**Verify:** ненулевой `grant_id` (скрипт печатает prefix/длину).  
Альтернатива без `SUBJECT_TOKEN`: SSO → `account.accessToken` → `POST /api/fvks/connect` с cookie (нужен отдельный KC redirect на localhost).

### 2b. Events URL (не prod)

1. В `.env.local`: `FVKS_EVENTS_TOKEN`, опц. signing.  
2. Callback: `{APP_URL}/api/webhooks/fvks/{FVKS_EVENTS_TOKEN}`  
   (Sim путь **с** `/api`; FMAH был `/webhooks/fvks/…` — не копировать хост 1:1).  
3. Если FVKS не видит localhost → `bb connect expose 3000`.  
4. Обновить **стендовый** `FVKS_MCP_HUB_EVENTS_URL` или admin events URL клиента (админка побеждает секрет).  
5. Connect → deploy FVKS-trigger (grant из connection) → событие meet → лог `FvksWebhookIngress` `dispatched ≥ 1`.

Пока FMAH жив: **prod** `FVKS_MCP_HUB_EVENTS_URL` не трогать.

### 2c. Agents API panel

1. `.env.local`: `HUB_APP_KEYS=fvks:<секрет≥32>` (= meet `AGENT_HUB_SECRET`).  
2. Meet/стенд: `AGENT_HUB_URL={APP_URL}` (без хвоста `/api/app/v1`), тот же secret, `AGENT_HUB_APP=fvks`.  
3. Smoke: комната → панель → `GET …/panel` 200; connect при `connected:false`.

---

## 3. Порядок prod cutover (после «погнали» — ссылка, не команды apply)

Детальный uninstall/apply: `deploy/CUTOVER-fmah-to-sim.md`. Здесь только **порядок**:

1. DNS + KC + `hub-secrets` Sim готовы (разделы 0–1).  
2. Dry-run уже зелёный.  
3. Окно: снять FMAH release `hub` → выкатить `fm-ai-hub`.  
4. **Events:** переписать `FVKS_MCP_HUB_EVENTS_URL` →  
   `https://hub.fm.flomni.ru/api/webhooks/fvks/{FVKS_EVENTS_TOKEN}`  
   (и/или admin events URL). Restart meet-подов при смене секрета.  
5. **Agents:** `AGENT_HUB_URL=https://hub.fm.flomni.ru`, secret = `HUB_APP_KEYS`, `AGENT_HUB_APP=fvks`.  
6. Ротация URL: сначала новый принимает трафик → verify → старый FMAH URL снять.  
7. Invite; `hub.hidden-route.com` — снять/редирект по решению.

Не смешивать knobs: events ≠ `AGENT_HUB_*`; exchange/MCP ≠ events URL.

---

## 4. Verify (prod)

| # | Проверка | Ок? |
| --- | --- | --- |
| 4.1 | TLS `https://hub.fm.flomni.ru` | ☐ |
| 4.2 | Health app + realtime/websocket | ☐ |
| 4.3 | SSO login (Sim callback) | ☐ |
| 4.4 | Бренд «FM AI Hub» | ☐ |
| 4.5 | `POST /api/fvks/connect` → `grant_id` (session или `subject_token`) | ☐ |
| 4.6 | Push FVKS → workflow run на хабе | ☐ |
| 4.7 | Панель агентов meet: panel 200, connect, run → execution | ☐ |
| 4.8 | Catch-up cron/API, если хаб может простаивать >~40 мин | ☐ |

---

## 5. Rollback (без эскалации в uninstall-окно)

| Слой | Откат |
| --- | --- |
| **Events URL** | Вернуть `FVKS_MCP_HUB_EVENTS_URL` / admin URL на FMAH `{HUB_PUBLIC_URL}/webhooks/fvks/{token}`; restart meet |
| **Agents API** | `AGENT_HUB_URL` → старый FMAH base; secret без смены, если переносили 1:1 |
| **Localdev / стенд** | Вернуть admin events URL на FMAH или отключить стендовый клиент; `localdev-down` |
| **DNS** | Пока FMAH жив — A-запись на Sim не обязательна для отката meet; не переключать prod events до паритета |
| **hub-secrets** | Восстановить из `hub-secrets-fmah.backup.yaml` **только** если уже меняли live secret FMAH (обычно Sim secret готовят отдельно) |
| **После uninstall FMAH** | Вне этого файла: re-install `hub-tenant` из бэкапа chart/values + secret backup — отдельное «погнали» |

Правило: до uninstall FMAH откат = **вернуть meet knobs** на старый хаб; Sim localdev/prod URL можно оставить для теста.

---

## 6. Явно не делать в `/2f`

- `helm uninstall hub` / `Deploy hub` `dry_run=false` / массовый `kubectl apply`
- Переключение **prod** events URL до паритета и команды
- Ломание Keycloak-клиента FMAH
- Type-check / full `next build` на MacBook Air (`HUSKY=0` для docs-only push)

---

## 7. Ссылки

| Файл | Роль |
| --- | --- |
| `deploy/CUTOVER-fmah-to-sim.md` | окно uninstall/apply |
| `docs/deploy/token-exchange-fvks-mcp.md` | `/2c` поток |
| `docs/deploy/fvks-events-url-cutover.md` | `/2d` Callback |
| `docs/deploy/agents-api-meet-cutover.md` | `/2e` панель |
| `deploy/LOCALDEV.md` | стенд + `SUBJECT_TOKEN` smoke |
| `deploy/hub-secrets.example.md` | имена ключей |
| `deploy/bin/localdev-fvks-smoke.sh` | live smoke |

*Собрано `/2f`, 2026-11-05. Подготовка — не uninstall.*
