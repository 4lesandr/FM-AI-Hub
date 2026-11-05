# Localdev — FM AI Hub (лёгкий стенд)

Цель: поднять Sim на готовом `.next` для ручного теста (FVKS hooks, UI, SSO later).  
**Запрещено на Air:** `turbo type-check`, `tsc`, full `next build` / monorepo rebuild.

Артефакт: `apps/sim/.next` · `BUILD_ID=qYe2j_9dW8uBe6t4XPi2L`  
(запас: `stand/artifacts/sim-next-build.tgz`)

## Предусловия

- `bun` в PATH (`~/.bun/bin`)
- Postgres с БД `simstudio` (схему уже мигрировали — не гонять migrate без нужды)
- Redis
- Env: `apps/sim/.env.local` (и при необходимости корневой `.env`)

Типичные URL в `.env.local` (brew postgres/redis на дефолтных портах):

```
DATABASE_URL=postgresql://postgres:…@127.0.0.1:5432/simstudio
REDIS_URL=redis://127.0.0.1:6379
NEXT_PUBLIC_APP_URL=http://localhost:3000
BETTER_AUTH_URL=http://localhost:3000
SOCKET_SERVER_URL=http://127.0.0.1:3002
NEXT_PUBLIC_SOCKET_URL=http://127.0.0.1:3002
```

## Вариант A — хост (предпочтительно на Air)

Postgres + Redis уже через Homebrew (`postgresql@17`, `redis`).

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /path/to/sim-sandbox   # или FM-AI-Hub

# App (готовое .next, без rebuild)
cd apps/sim && bun run start
# → http://localhost:3000

# Realtime (другой терминал)
set -a && source apps/sim/.env.local && set +a
cd apps/realtime && bun run start
# → http://localhost:3002/health
```

Или одной командой:

```bash
bash deploy/bin/localdev-up.sh
```

Остановка: `bash deploy/bin/localdev-down.sh`

## Вариант B — Docker только для infra

Если нужен изолированный Postgres/Redis (не brew):

```bash
# Docker Desktop должен быть запущен
docker compose -f docker-compose.local.yml -f docker-compose.host-dev.yml up -d db redis
# db → localhost:5433, redis → localhost:6380
```

В `apps/sim/.env.local` тогда:

```
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/simstudio
REDIS_URL=redis://127.0.0.1:6380
```

Миграции (только если схема пустая) — через compose `migrations` или точечный `bun run db:migrate` в `packages/db`.  
App + realtime — снова на хосте (`bun run start`), **не** поднимать сервис `simstudio` из compose (он тянет image build).

## FVKS token-exchange (/2c2) — live smoke

Не требуется для подъёма стенда. Значения секретов **не** коммитить и **не** печатать.

### Откуда взять env (контур FMAH Flomni)

| Имя в Sim `.env.local` | Источник (без печати значений) |
| --- | --- |
| `HUB_OIDC_ISSUER` | `kubectl -n hub get deploy hub-api` env **или** `deploy/tenants/flomni.yaml` → `oidc.issuer` (`https://auth.flomni.com/realms/fteam`) |
| `HUB_OIDC_CLIENT_ID` | то же → `hub` |
| `HUB_OIDC_CLIENT_SECRET` | `kubectl -n hub get secret hub-secrets` ключ `HUB_OIDC_CLIENT_SECRET` |
| `HUB_OIDC_PROVIDER_ID` | `keycloak` (или `SSO_PROVIDER_ID`, если SSO в Sim заведён под другим id) |
| `HUB_IDP_AUDIENCES` | hub-api env / `oidc.idpAudiences` → `fvks=meet` |
| `FVKS_MCP_URL` | hub-api env / `apps.fvks` → `https://meet.fm.flomni.ru/mcp` |
| `FVKS_MCP_CLIENT_ID` / `FVKS_MCP_CLIENT_SECRET` | FMAH connector `fvks` (`oauth_client_*`, decrypt `HUB_KEK`) — то же, что terraform `fvks_pairs.mcp_client_*` / helm `agentHub.mcpClientId` |
| `FVKS_MCP_TOKEN_URL` | обычно не нужен (discovery от MCP URL) |

Одной командой (upsert в `apps/sim/.env.local`, значения не пишет в stdout):

```bash
bash deploy/bin/localdev-fvks-env-from-contour.sh
bash deploy/bin/localdev-down.sh && bash deploy/bin/localdev-up.sh
```

Альтернатива: GitHub Actions vars/secrets репо FMAH (`HUB_OIDC_*`, `HUB_IDP_AUDIENCES`) + пара MCP из state/`pair-fvks` — тоже без эха в чат/git.

### SSO access token → `account` (для POST без `subject_token`)

`connectFvksForUser` читает `account.accessToken` где `providerId` = `HUB_OIDC_PROVIDER_ID` (default `keycloak`).

1. В `.env.local` включить SSO на тот же realm: `SSO_ENABLED=true`, `SSO_PROVIDER_ID=keycloak`, `SSO_PROVIDER_TYPE=oidc`, `SSO_ISSUER` (= `HUB_OIDC_ISSUER`), `SSO_OIDC_CLIENT_ID` / `SSO_OIDC_CLIENT_SECRET`.
2. **Отдельный** Keycloak client (или доп. redirect) на `http://localhost:3000/.../callback` — прод-клиент `hub` не ломать.
3. Войти в UI → better-auth кладёт access token в `account`.
4. `POST /api/fvks/connect` с cookie сессии, тело `{}`.

Localdev без правки Keycloak redirects: передать `subject_token` (Keycloak access того же пользователя) в теле — паритет FMAH Agents connect. Токен взять из DevTools после входа в FMAH hub / Keycloak; в git/чат не класть.

### Smoke

```bash
# нужен свежий Keycloak access (в FMAH account на контуре сейчас все expired)
SUBJECT_TOKEN='…' bash deploy/bin/localdev-fvks-smoke.sh
```

Ожидание: ненулевой `grant_id` (скрипт печатает только prefix/длину).  
Если `.next` ещё без `/api/fvks/connect` (артефакт до `658e438`) — скрипт сам уходит в `bun` → `lib/fvks` (тот же exchange). HTTP-путь после лёгкого rebuild на Modal.  
Дизайн: `docs/deploy/token-exchange-fvks-mcp.md`.

## FVKS events push (/2d) — optional

В `.env.local` (имена; значения не в git):

```
FVKS_EVENTS_TOKEN=…          # ≥16; сегмент пути Callback
# FVKS_EVENTS_SIGNING_SECRET=…  # опц. HMAC
```

Callback для оператора meet (секрет `FVKS_MCP_HUB_EVENTS_URL` **или** admin events URL клиента `FM AI Hub`):

`{NEXT_PUBLIC_APP_URL}/api/webhooks/fvks/{FVKS_EVENTS_TOKEN}`

Не путать с `AGENT_HUB_URL` (панель агентов — `/2e`).  
Чеклист: `docs/deploy/fvks-events-url-cutover.md`.  
После connect: deploy FVKS trigger (grant авто из connection) → событие meet → 204 на ingress.  
Догон: `POST /api/fvks/events/catch-up` (сессия).

## Проверка

```bash
curl -sI http://127.0.0.1:3000/ | head -1    # 307/200 ок
curl -s http://127.0.0.1:3002/health         # {"status":"ok",…}
```

Удалённый просмотр из bb: `bb connect expose 3000` → URL вида `https://…--3000.getbb.app`.

## Push docs

Если коммит только документации: `HUSKY=0 git push` (хук type-check на Air не гонять).
