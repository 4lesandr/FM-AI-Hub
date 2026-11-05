# MVP-срез: Install по ссылке

Порядок из `deploy/PROCESS-install-appstore.md`. Каталог/поиск, UI kit, FMAH — вне скоупа.

## Задачи (минимальный вертикальный срез)

| # | Задача | Done when |
| --- | --- | --- |
| 1 | **Schema**: `agent_release` (workflowId, version/state sanitized, shareToken, createdBy) + `agent_installation` (userId, releaseId pinned, updatePolicy: pending\|accepted\|deferred\|current, revokedAt) | Миграция в `packages/db`; без type-check на Mac |
| 2 | **API Publish**: session `POST` publish from workflow → snapshot via `sanitizeWorkflowForSharing` → token link | Author получает URL; секреты автора в snapshot отсутствуют |
| 3 | **API Resolve + Install**: `GET` by token (мета без секретов); `POST` install → Installation + credential bind installer | User ставит себе; Identity на run = installer |
| 4 | **API Updates**: list pending; accept (repin release); defer | После Publish N+1 у Installation виден pending |
| 5 | **UI**: одна страница link → «Поставить себе»; бейдж «есть обновление» + Accept/Defer | Без каталога и без fork UX |
| 6 | **Runtime bind**: execute path читает credentials/installation user, не owner release | Проверка: run под installer session |
| 7 | **Revoke**: delete/soft-revoke Installation | Издание у других не затрагивается |

## Вне среза (явно)

- AgentListing / поиск / витрина
- Auto-update без Accept
- Fork sync как канал обновлений
- Блокировка на k8s runtime: разработка API/UI на стенде после ns `hub` допустима параллельно

## Правила исполнения

- Только необходимые файлы; **не** гонять `bun`/`turbo` type-check на Air/Mac
- Git: `HUSKY=0 git commit` / `HUSKY=0 git push`
- Тяжёлые сборки — Modal; next-артефакт не пересобирать без нужды
