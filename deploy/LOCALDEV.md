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

## Проверка

```bash
curl -sI http://127.0.0.1:3000/ | head -1    # 307/200 ок
curl -s http://127.0.0.1:3002/health         # {"status":"ok",…}
```

Удалённый просмотр из bb: `bb connect expose 3000` → URL вида `https://…--3000.getbb.app`.

## Push docs

Если коммит только документации: `HUSKY=0 git push` (хук type-check на Air не гонять).
