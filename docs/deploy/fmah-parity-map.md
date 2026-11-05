# FMAH → FM AI Hub (Sim): карта паритета до cutover

Карточка `/2a`. Источник as-is: `Documents/WSiva/FMAH-interviewer` (= прод FMAH / hub-tenant; зеркало `FMAH` совпадает по сервисам). To-be: `Documents/XSiva/sim-sandbox` (`4lesandr/FM-AI-Hub`, ветка `feat/fm-mvp`). Секреты и значения токенов не фиксируются.

**Скоуп паритета (обязателен до uninstall FMAH):** (1) протокол встречи/событий FVKS/fvcs (2) триггеры (3) автообмен токенов (4) MCP.

---

## 0. Онтология (as-is FMAH)

| Сущность | Где | Смысл |
| --- | --- | --- |
| `Tenant` / `Principal` | `packages/db` | Тенант + человек (`external_sub` = Keycloak `sub`) или system |
| `Connector` | db | MCP-приложение: `fvks` / wiki / messenger / external; `mcp_url`, `auth_mode`, `event_delivery` ∈ {`fvks_hub`,`poll`,`none`} |
| `Connection` + `ConnectionSecret` | db | Согласие человека на приложение; токены envelope (`HUB_KEK`); `grant_id`, `subject`, `scopes`, `acquired_via` ∈ {`manual_oauth`,`token_exchange`,`api_key`} |
| `ToolDef` / `EventTypeDef` | db | Каталог tools + типы событий (`events://catalog`, ADR 0005) |
| `Agent` / `AgentVersion` / `Trigger` | db | Агент в правах владельца; триггеры материализуются из версии |
| `Event` / `EventSubscription` / `Dispatch` | db | Журнал событий, догон, аудит «почему (не) запустился» |
| `Run` / `ToolCall` / `Approval` | db | Рантайм Mastra + HITL |
| `hub-api` / `hub-worker` / `hub-live` | services | HTTP+OAuth+вебхуки / очередь pg-boss / голос в LiveKit |

Контракт с FVKS (meet / fvcs): `FVKS/docs/agent-hub-integration.md` + ADR 0004.

---

## 1. Протокол встречи / события FVKS (fvcs)

### As-is FMAH

**A. События (push + catch-up)**

| Элемент | Деталь |
| --- | --- |
| Ingress | `POST /webhooks/fvks/:token` (`hub-api` `events/webhooks.controller`) |
| Токен пути | 32 байта; в DB хэш + ciphertext; ротация с prev; CLI `oauth:register -- fvks` |
| Тело | `{ event, grant_id, subject }` + заголовки `x-fvks-*`; опц. HMAC `x-fvks-signature` |
| Маршрутизация | `Connection` по `grant_id` + сверка `subject` |
| Журнал | дедуп `(connector, external_id)`, `audience[]` расширяется на каждого адресата |
| Догон | `list_events` (worker cron `HUB_EVENTS_CATCH_UP_CRON`, ~10 мин + старт) |
| Отзыв | `grant.revoked` / `invalid_grant` / UI → `closeConnection` (токены↓, events↓, triggers pause) |
| Каталог типов | MCP resource `events://catalog` → `EventTypeDef` |

**B. Панель агентов внутри Встреч (Agents API)**

| Элемент | Деталь |
| --- | --- |
| База | `HUB/api/app/v1` (ADR 0011, `docs/agents-api.md`) |
| Auth | Bearer JWT HS256: `iss=fvks`, `aud=fmah-agents`, `sub`=Keycloak; секрет из `HUB_APP_KEYS` |
| Методы | `GET /panel`, `POST …/runs`, SSE events, approvals, `POST /connect`, live-sessions |
| У FVKS | `AGENT_HUB_URL` + `AGENT_HUB_SECRET` |

**C. Голос агента в комнате**

| Элемент | Деталь |
| --- | --- |
| API | `POST /api/app/v1/agents/:id/live-sessions` (+ GET/stop) |
| Runtime | `hub-live` → LiveKit приложения; allowlist `HUB_APP_LIVEKIT_HOSTS` |

**D. MCP-инструменты встреч**

Через `Connection` владельца: Hub открывает MCP-клиент к `FVKS_MCP_URL`, агент токен не видит.

### Sim сейчас

| Есть | Нет / gap |
| --- | --- |
| Ingress `POST /api/webhooks/fvks/[token]` + HMAC/token verify (`lib/webhooks/providers/fvks.ts`) | Нет журнала Event/audience/Dispatch как у FMAH |
| Триггеры FVKS; fan-out по `grant_id`; deploy: **auto** из stored connection (`/2c`) или ручной `grantId` | Упрощённый дедуп (нет audience[] FMAH) |
| Env `FVKS_EVENTS_TOKEN`, `FVKS_EVENTS_SIGNING_SECRET` | |
| Catch-up: `list_events` → `lib/fvks/catch-up` + `POST /api/fvks/events/catch-up` + cron `/api/cron/fvks-events-catch-up`; cursor в connection | Полный Event journal / Dispatch-аудит — нет |
| Операторский cutover URL: `docs/deploy/fvks-events-url-cutover.md` | **Нет** `/api/app/v1` (panel) — `/2e` |
| | **Нет** live-sessions / hub-live |
| | Нет `events://catalog` sync |

### Перенос (минимум до cutover)

1. Сохранить контракт FVKS: один events URL на окружение → Sim; оператор meet/fvcs переписывает **`FVKS_MCP_HUB_EVENTS_URL`** (не `AGENT_HUB_*`) — чеклист `/2d`.
2. Grant routing: `grant_id` из token-exchange в connection + auto routing key на deploy (`/2c`+`/2d`).
3. Agents API для панели Встреч: либо порт `/api/app/v1` на Sim (адаптер поверх workflow/chat), либо смена FVKS на новый контракт **до** cutover — иначе UI агентов в meet ломается.
4. Live-in-room: отдельный slice (не блокер событийных агентов, но блокер голосовых агентов в комнате).

---

## 2. Триггеры

### As-is FMAH

| Поле / поведение | Значение |
| --- | --- |
| `Trigger.kind` | `event` \| `schedule` \| `manual` |
| Event | `eventTypeDefId` + `connectionId` + JSON `filter` (`$me`, space, enum из catalog) |
| Concurrency | `skip` \| `queue` \| `parallel` |
| Stop (ADR 0008) | `stop.on[]` (eventType+match) + `afterSec` |
| Dispatch | запись matched/skipped/run_created на `(event, trigger)` |
| Schedule | cron + timezone (worker tick) |
| Delivery modes | FVKS webhook; wiki/messenger — poll `list_events` |

Код: `hub-worker` `dispatch-event.job`, `poll-events.job`, `schedule-tick.job`, `run-launcher`.

### Sim сейчас

| Есть | Gap |
| --- | --- |
| Workflow webhook triggers (в т.ч. FVKS provider, queue execution) | Нет filter/`$me`/catalog fields |
| Schedule (Trigger.dev / workflow schedule) | Нет stop-by-event; нет Dispatch-аудита FMAH-формы |
| Manual/chat start | Нет pause triggers on connection revoke (связка с Connection) |
| FVKS match по `event.type` | Узкий набор типов (2+any); FMAH — любой тип из catalog |

### Перенос

- Событийный паритет FVKS: webhook → match type (+ позже filter) → run workflow от **installer identity**.
- Schedule/manual уже близки к Sim-модели; маппить `Trigger` FMAH → trigger blocks / deployment config.
- Catch-up и revoke-cascade — отдельные задачи (иначе дыры после простоя / отзыва grant).

---

## 3. Автообмен токенов

### As-is FMAH

Поток (ADR 0003 update 2026-10-08, `AutoConnectService`):

```
Keycloak login (access token в account)
  → RFC 8693 token-exchange (HUB_OIDC_CLIENT_*, audience из HUB_IDP_AUDIENCES)
  → assertion JWT
  → app token endpoint grant_type=jwt-bearer (RFC 7523)
  → ConnectionSecret + activate + syncTools/Events + ensureSubscription
```

| Триггер | API / hook |
| --- | --- |
| Вход в консоль | `onSignIn` → `connectAll` |
| Из приложения серии | `POST /api/app/v1/connect` `{ subject_token }` |
| Ручной OAuth | `POST /connections` → `/oauth/callback` (`acquired_via=manual_oauth`) |
| Refresh | `TokenManager` + advisory lock; SDK без refresh_token |

Env (имена, без значений): `HUB_OIDC_ISSUER`, `HUB_OIDC_CLIENT_ID/SECRET`, `HUB_IDP_AUDIENCES` (`fvks=meet,…`), preregistered client на коннекторе (`oauth:register`).

Ограничение: приложение должно принимать jwt-bearer (`FVKS_MCP_ASSERTION_PARTY`); wiki/messenger — в основном моки/ручной OAuth.

### Sim сейчас

| Есть | Gap |
| --- | --- |
| MCP OAuth authorization_code + refresh (`lib/mcp/oauth`) | Auto sign-in hook ещё не вызван |
| `/2c` `lib/fvks/*` + `POST /api/fvks/connect` | Live secrets + SSO account token в стенде |
| Env `HUB_OIDC_*`, `HUB_IDP_AUDIENCES`, `FVKS_MCP_*` | Таблица `fvks_connection` (сейчас env ciphertext + Redis grant index) |
| SSO better-auth / org IdP | Полный Agents `POST /api/app/v1/connect` — позже `/2e` |

Дизайн: `docs/deploy/token-exchange-fvks-mcp.md`.

### Перенос

1. После SSO в Sim: exchange → jwt-bearer → сохранить токены + **grant_id** (критично для webhook routing). **Код `/2c`.**
2. Эквивалент `POST …/connect` для сервера FVKS: `POST /api/fvks/connect` `{ subject_token }` (**есть**); панель Agents — `/2e`.
3. Realm: право клиента хаба на token-exchange к `meet` (и др.) — уже для FMAH; перенастроить redirect/client под Sim, не ломая FMAH до cutover.

---

## 4. MCP

### As-is FMAH (`packages/mcp` + worker)

| Способность | Деталь |
| --- | --- |
| Клиент к app MCP | `openMcpClient` / Mastra `MCPClient`; streamable HTTP |
| OAuth client | DCR/PKCE, `HubOAuthProvider`, `PgOAuthStorage` |
| Токены | envelope `HUB_KEK`; extras `grant_id`/`subject` через `captureTokenExtras` |
| Политика tools | `classifyEffect` (read/write/destructive); allowlist версии; untrusted notice |
| External MCP | URL allowlist (`HUB_ALLOW_LOCAL_MCP`); vendor OAuth / api_key |
| Egress | прямой к MCP; модели — отдельный `HTTPS_PROXY` |

Агент **никогда** не получает сырой токен FVKS — только tool calls через Hub.

### Sim сейчас

| Есть | Gap vs FMAH-паритет |
| --- | --- |
| MCP client + OAuth к внешним серверам; UI servers | Нет first-class Connector/Connection/grant_id модели FVKS |
| Sim как MCP **server** (Copilot/workflow tools) | Другая роль: не заменяет client-to-FVKS |
| Tool blocks / credentials | Нет эффекта read/write policy + Approval как в FMAH (частично есть tool confirm) |
| | Нет обязательного «run только credentials installer’а» для install-by-link (см. `docs/deploy/as-is-sim-api-hooks.md`) |

### Перенос

- Подключить FVKS MCP как managed/external server с OAuth **или** token-exchange minter.
- Runtime: tools агента/workflow → MCP call под credential владельца установки.
- Не путать: «Sim MCP server наружу» ≠ «доступ агента к MCP Встреч».

---

## 5. API surface (сводка для переноса)

### FMAH hub-api (релевантное скоупу)

| Метод | Назначение |
| --- | --- |
| `POST /webhooks/fvks/:token` | События FVKS |
| `GET/POST/DELETE /connections*`, `POST …/sync` | Подключения MCP |
| `GET /oauth/callback` | OAuth finish |
| `GET /connectors/:id/tools\|events\|…` | Каталог |
| `POST /agents/:id/run`, approvals, shares | Рантайм консоли |
| `/api/app/v1/*` | Протокол для FVKS UI + connect + live |
| Live console routes | `agents/:id/live-sessions` (консоль) |

### Sim (релевантное)

| Метод / модуль | Назначение |
| --- | --- |
| `POST /api/webhooks/fvks/[token]` | WIP события FVKS |
| `/api/mcp/oauth/*`, MCP settings | OAuth к внешним MCP |
| Workflow deploy + triggers | Запуски по событию/cron |
| **Нет** `/api/app/v1` | Разрыв с meet UI |

---

## 6. Env map (имена)

| FMAH | Роль | Sim-аналог / действие |
| --- | --- | --- |
| `HUB_PUBLIC_URL` | OAuth redirect + events URL base | `NEXT_PUBLIC_APP_URL` / APP_URL |
| `HUB_KEK` | Envelope токенов MCP | `ENCRYPTION_KEY` (пересобрать secret; не копировать) |
| `HUB_OIDC_*` | SSO Keycloak | better-auth IdP / org SSO Sim |
| `HUB_IDP_AUDIENCES` | Auto token exchange | **нет** — добавить |
| `HUB_APP_KEYS` | Agents API HMAC | **нет** — добавить или сменить FVKS |
| `HUB_APP_LIVEKIT_HOSTS` | Голос в комнате | **нет** |
| `FVKS_MCP_URL` / `FVKS_HUB_API_URL` | MCP + members REST | MCP server URL credential |
| Events token / signing (на connector) | Ingress auth | `FVKS_EVENTS_TOKEN`, `FVKS_EVENTS_SIGNING_SECRET` |
| `HUB_EVENTS_CATCH_UP_CRON` / `HUB_EVENTS_CATALOG_CRON` | Догон + catalog | **нет** |
| `HUB_ALLOW_LOCAL_MCP` | Dev SSRF relax | свои domain allowlists Sim |
| `DATABASE_URL`, queue pools | PG + pg-boss | PG Sim (+ Trigger.dev) |
| `BETTER_AUTH_*` | Сессии | свои Sim auth secrets |

Cutover ops: `sim-sandbox/deploy/CUTOVER-fmah-to-sim.md` (secrets пересобрать, не переносить FMAH keys).

---

## 7. Gap vs Sim (матрица паритета)

| # | Функция | FMAH | Sim | До cutover |
| --- | --- | --- | --- | --- |
| 1 | FVKS events ingress + signature/token | done | WIP done | Переключить URL у оператора fvcs |
| 2 | Route by grant_id | Connection auto | auto из connection + optional manual | `/2d` |
| 3 | Event journal, audience, dedupe, Dispatch | done | нет | Упростить допустимо, поведение «1 run / audience» сохранить |
| 4 | `list_events` catch-up | done | cursor + cron/API `/2d` | Включить cron до prod cutover |
| 5 | Trigger filters / `$me` / catalog | done | нет | MVP: type-only; filters — next |
| 6 | Stop-on-event / concurrency | done | частичный | По приоритету продукта |
| 7 | Keycloak token-exchange → jwt-bearer | done | **код `/2c`** | Нужен live exchange + secrets |
| 8 | Manual MCP OAuth + refresh | done | есть | Ок как fallback |
| 9 | MCP tools от имени пользователя | done | generic MCP + `getFvksMcpAuthHeaders` | Привязать tool runtime к stored grant |
| 10 | Agents API panel в meet | done | **нет** | **Обязателен** или смена FVKS |
| 11 | Live agent in LiveKit room | done | **нет** | Отдельный slice; голосовые агенты |
| 12 | Install-by-link identity | FMAH shares | WIP `/3` | См. as-is-sim-api-hooks; не блокер events |

**Блокеры cutover (строго):** 1+7+9 (события+токены+MCP), и **10** если meet UI агентов остаётся на старом контракте. **4** — сильный риск потери событий. **11** — если в проде есть голосовые агенты в комнатах.

---

## 8. Рекомендуемый порядок реализации в Sim

1. Token exchange + FVKS MCP credential (grant_id)  
2. Events URL cutover-ready (token/signing) + type match → workflow  
3. Catch-up `list_events`  
4. Agents API adapter **или** согласованный breaking change во FVKS  
5. Filters/catalog/stop — углубление  
6. Live-in-room  

Localdev проверка: карточка `/2b` (лёгкий стенд, без turbo type-check на Air).

---

## 9. Источники

- FMAH: `docs/data-model.md`, ADR 0003/0004/0005/0008/0010/0011/0018, `docs/agents-api.md`, `.env.example`
- FVKS: `docs/agent-hub-integration.md`, `docs/event-schema.md`
- Sim: `apps/sim/lib/webhooks/providers/fvks.ts`, `triggers/fvks/*`, `deploy/CUTOVER-fmah-to-sim.md`
- CTO notebook: `process-fmah-parity.md`

*Составлено: 2026-11-05, тред `/2a` `thr_dukf3rtqib`.*
