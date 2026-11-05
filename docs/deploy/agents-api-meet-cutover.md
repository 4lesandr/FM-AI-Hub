# /2e — Agents API панели Встреч (meet → Sim)

Блокер cutover: FVKS UI агентов ходит на `AGENT_HUB_URL/api/app/v1` с JWT (`iss=fvks`, `aud=fmah-agents`, секрет `AGENT_HUB_SECRET` ↔ Hub `HUB_APP_KEYS`).  
Без совместимого адаптера на Sim панель meet отвалится при смене URL.

**Выбор:** совместимый адаптер на Sim (код ниже). Смена контракта во FVKS **не** требуется.

Опора: FMAH `docs/agents-api.md` / ADR 0011, `docs/deploy/fmah-parity-map.md` §1B, FVKS `fvks_agents/hub.py`.

Секреты и значения токенов **не** класть в тикеты/логи — только имена ключей.

---

## 1. Что переписывать (и что нет)

| Knob | Назначение | Этот slice |
| --- | --- | --- |
| **`AGENT_HUB_URL`** (meet secrets) | База Hub для панели агентов | **да** → URL Sim (`https://hub.fm.flomni.ru` / localdev) |
| **`AGENT_HUB_SECRET`** | HMAC справки JWT | **да** — тот же секрет, что в Sim `HUB_APP_KEYS` |
| `AGENT_HUB_APP` | обычно `fvks` | проверить; должен совпасть с `iss` / ключом в `HUB_APP_KEYS` |
| **`FVKS_MCP_HUB_EVENTS_URL`** | push событий | **нет** — `/2d` |
| `HUB_OIDC_*` / `FVKS_MCP_*` | token-exchange + MCP | уже `/2c` |

Форма ключа на Sim: `HUB_APP_KEYS=fvks:<секрет≥32 символов>`.  
Если slug коннектора другой: `приложение@коннектор:секрет`.

---

## 2. Контракт (без изменений у FVKS)

База: `{AGENT_HUB_URL}/api/app/v1`

| Метод | Поведение на Sim |
| --- | --- |
| `GET /panel?room_id=&recording_id=` | агенты = FVKS-webhook workflows пользователя + его active chats; `connected` из FVKS connection store |
| `POST /connect` `{ subject_token }` | тот же путь, что `/api/fvks/connect` (exchange → grant_id) |
| `POST /agents/:id/runs` | `executeWorkflowService` (async) поверх workflow агента / chat.workflowId |
| `GET /runs/:id`, `…/events` (SSE), `…/cancel` | метаданные run + статус из `workflow_execution_logs` |
| `GET /threads/:id` | runs по threadId |
| `POST /agents/:id/access` | `{ app: null, url: null }` (consent cascade FMAH пока не портирован) |
| `POST /approvals/:id/decision` | 404 до HITL-паритета |
| Auth | Bearer JWT HS256, `aud=fmah-agents`, одноразовый `jti` (Redis / memory) |

Live-sessions / голос в комнате — **вне** этого slice (parity map §1C).

---

## 3. Чеклист localdev

1. В `apps/sim/.env.local`: `HUB_APP_KEYS=fvks:<секрет≥32>` (тот же, что у meet `AGENT_HUB_SECRET`).
2. Sim localdev (`deploy/LOCALDEV.md`); при необходимости `bb connect expose 3000`.
3. У meet/стенда: `AGENT_HUB_URL={APP_URL}` (без хвоста `/api/app/v1`), `AGENT_HUB_SECRET=<тот же>`.
4. Smoke: открыть комнату → панель агентов → `GET …/panel` 200; при `connected:false` — connect; пустой список агентов допустим, пока нет FVKS-workflow / chat у пользователя.
5. Опционально: deploy workflow с FVKS trigger от того же SSO-user → агент появляется в panel как `link: auto`.

---

## 4. Чеклист prod (после паритета + «погнали»)

1. В `hub-secrets`: `HUB_APP_KEYS=fvks:<секрет>` (можно перенести значение из FMAH `HUB_APP_KEYS` / meet `AGENT_HUB_SECRET`, не печатать).
2. Переписать meet `AGENT_HUB_URL` на `https://hub.fm.flomni.ru` (или актуальный ingress Sim).
3. Секрет meet и Sim совпадают; `AGENT_HUB_APP=fvks`.
4. Verify: панель в проде открывается; connect пишет `grant_id`; запуск агента создаёт execution на Sim.
5. Events URL (`FVKS_MCP_HUB_EVENTS_URL`) — отдельно по `/2d`, не смешивать.

---

## 5. Код / ссылки

| Путь | Роль |
| --- | --- |
| `apps/sim/app/api/app/v1/**` | HTTP surface |
| `apps/sim/lib/fvks/agents-api/**` | assertion, identity, panel/runs |
| `apps/sim/lib/fvks/auto-connect.ts` | connect |
| `deploy/hub-secrets.example.md` | имя ключа `HUB_APP_KEYS` |
