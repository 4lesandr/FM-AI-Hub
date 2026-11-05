# /2c — Token exchange + FVKS MCP (`grant_id`)

Карточка `/2c`. As-is: FMAH `AutoConnectService` + `Connection.grant_id` + MCP client к `FVKS_MCP_URL`.  
To-be в Sim (`feat/fm-mvp`): тот же поток токенов, без полной модели Connector/Connection FMAH.

Секреты и значения токенов не фиксируются.

---

## 1. Поток (паритет ADR 0003)

```
Keycloak access token (account SSO / subject_token из meet)
  → RFC 8693 token-exchange (HUB_OIDC_CLIENT_* → audience из HUB_IDP_AUDIENCES)
  → assertion JWT
  → FVKS token endpoint grant_type=jwt-bearer (RFC 7523) + FVKS_MCP_CLIENT_*
  → access(+refresh) + grant_id (+ subject)
  → encrypt → personal env `__SIM_FVKS_CONNECTION__`
  → Redis index fvks:grant:{grant_id} → userId (для lookup)
  → MCP calls: Authorization: Bearer <access> → FVKS_MCP_URL
```

Триггеры вебхуков по-прежнему матчятся по `providerConfig.grantId` (= routing key).  
После connect оператор/UI кладёт возвращённый `grant_id` в trigger (как сейчас вручную) — автоподстановка в deploy config = follow-up.

---

## 2. Модель credential / grant (Sim)

| Поле | Где | Смысл |
| --- | --- | --- |
| `grant_id` | ciphertext connection + Redis index | id согласия у FVKS; ключ fan-out `/api/webhooks/fvks/[token]` |
| `subject` `{id,type}` | ciphertext | `$me` / владелец grant |
| `access_token` / `refresh_token` / `expires_at` | ciphertext | токены MCP; агент сырой токен не видит |
| `acquired_via` | ciphertext | всегда `token_exchange` на этом пути |
| `mcp_url` | ciphertext + env `FVKS_MCP_URL` | куда открывать MCP client |
| `connector_slug` | ciphertext | `fvks` (задел под wiki/messenger) |

Хранение **без новой таблицы** (localdev `/2b` не трогаем миграцией):  
personal `environment.variables['__SIM_FVKS_CONNECTION__']` = `encryptSecret(JSON)`.  
Ключ системный — не использовать в workflow secrets.

Позже (паритет): таблица `fvks_connection` с индексом `(grant_id)` вместо env+Redis.

---

## 3. API

| Метод | Auth | Назначение |
| --- | --- | --- |
| `POST /api/fvks/connect` | session **или** body `{ subject_token }` (путь meet/Agents) | exchange → jwt-bearer → persist; ответ `{ grant_id, subject, connector, mcp_url }` (без токенов) |
| `GET /api/fvks/connection` | session | статус: есть ли grant, `grant_id`, `expires_at`, `mcp_url` |
| `POST /api/webhooks/fvks/[token]` | path token (+ HMAC) | уже есть; fan-out по `grant_id` |

Эквивалент FMAH `POST /api/app/v1/connect` на этапе `/2c` = `POST /api/fvks/connect` с `subject_token`.  
Полный Agents API panel (`/api/app/v1/*`) — карточка `/2e`, не этот slice.

---

## 4. Env (имена)

| Имя | Роль |
| --- | --- |
| `HUB_OIDC_ISSUER` | Keycloak realm issuer (без trailing `/`); fallback: `SSO_ISSUER` |
| `HUB_OIDC_CLIENT_ID` / `HUB_OIDC_CLIENT_SECRET` | клиент хаба с правом token-exchange |
| `HUB_OIDC_PROVIDER_ID` | `account.providerId` для чтения SSO access token (default: `SSO_PROVIDER_ID` или `keycloak`) |
| `HUB_IDP_AUDIENCES` | `fvks=meet` (slug=audience), как FMAH |
| `FVKS_MCP_URL` | MCP base URL Встреч |
| `FVKS_MCP_CLIENT_ID` / `FVKS_MCP_CLIENT_SECRET` | preregistered Hub client у FVKS (было `oauth:register -- fvks`) |
| `FVKS_MCP_TOKEN_URL` | опционально явный token endpoint; иначе discovery от `FVKS_MCP_URL` |
| `FVKS_EVENTS_TOKEN` / `FVKS_EVENTS_SIGNING_SECRET` | уже для ingress (не этот slice) |

Realm: право клиента хаба на exchange к `meet` уже есть для FMAH; для Sim — отдельный client/redirect, FMAH не ломать до cutover.

---

## 5. Код (этот PR)

| Путь | Что |
| --- | --- |
| `apps/sim/lib/fvks/token-exchange.ts` | RFC 8693 + jwt-bearer + grant extras |
| `apps/sim/lib/fvks/connection-store.ts` | encrypt persist + Redis grant index |
| `apps/sim/lib/fvks/auto-connect.ts` | orchestrate connect for user / subject_token |
| `apps/sim/lib/fvks/mcp-access.ts` | Bearer для вызова `FVKS_MCP_URL` |
| `apps/sim/app/api/fvks/connect/route.ts` | POST |
| `apps/sim/app/api/fvks/connection/route.ts` | GET |

---

## 6. Что осталось до рабочего exchange end-to-end

1. Заполнить secrets (`HUB_OIDC_*`, `FVKS_MCP_*`, `HUB_IDP_AUDIENCES`) в `.env.local` / `hub-secrets`.
2. SSO Keycloak в Sim так, чтобы в `account` лежал access token (`HUB_OIDC_PROVIDER_ID`).
3. Один live `POST /api/fvks/connect` → ненулевой `grant_id`.
4. Вставить `grant_id` в FVKS trigger deploy; smoke webhook + MCP tool call под stored Bearer.
5. (Опц.) hook after SSO sign-in → `connectAll` без ручного POST; Agents API `/api/app/v1`.

Localdev `/2b`: только новые optional env; compose/start scripts не менять.
