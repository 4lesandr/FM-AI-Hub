# /2d — FVKS events Callback URL → Sim

Операторский чеклист: переписать адрес push-событий FVKS (meet/fvcs) с FMAH на Sim.  
Секреты и значения токенов в тикеты/логи **не** класть — только имена ключей и форма URL.

Опора: `docs/deploy/fmah-parity-map.md` §1, FVKS `docs/agent-hub-integration.md`, ingress Sim `POST /api/webhooks/fvks/[token]`.

---

## 1. Что именно переписывать (и что нет)

| FVKS knob | Назначение | Этот slice |
| --- | --- | --- |
| **`FVKS_MCP_HUB_EVENTS_URL`** (secret meet-secrets / GitHub) | Push событий в HUB: **полный URL с токеном в пути** | **да** — localdev → prod |
| Админка MCP client → **events URL** | То же; **приоритет над секретом** | **да**, если URL уже вписан клиенту |
| `FVKS_MCP_HUB_CLIENT_NAME` (обычно `FM AI Hub`) | Какому клиенту применяется events URL | проверить имя, не менять без нужды |
| **`AGENT_HUB_URL` / `AGENT_HUB_SECRET`** | Панель агентов во Встречах (`/api/app/v1`) | **нет** — карточка `/2e`, не events |

Имена без значений. Токен пути = `FVKS_EVENTS_TOKEN` на стороне Sim (тот же сегмент, что в URL).

---

## 2. Форма URL

| Окружение | База Sim | Callback (шаблон) |
| --- | --- | --- |
| **localdev** | `NEXT_PUBLIC_APP_URL` (`http://localhost:3000` или `bb connect expose 3000`) | `{APP_URL}/api/webhooks/fvks/{FVKS_EVENTS_TOKEN}` |
| **prod** | `https://hub.fm.flomni.ru` | `https://hub.fm.flomni.ru/api/webhooks/fvks/{FVKS_EVENTS_TOKEN}` |
| as-is FMAH (снять после паритета) | `HUB_PUBLIC_URL` (напр. `https://hub.hidden-route.com`) | `{HUB_PUBLIC_URL}/webhooks/fvks/{token}` — **без** `/api` |

Важно: у Sim путь **`/api/webhooks/fvks/…`**, у FMAH — **`/webhooks/fvks/…`**. Копировать старый URL и только сменить хост — сломает доставку.

Опционально HMAC: `FVKS_EVENTS_SIGNING_SECRET` на Sim ↔ «events signing secret» у клиента FVKS (`x-fvks-signature`). Без секрета Sim подпись не требует (удобно для localdev).

---

## 3. Чеклист localdev (минимум до рабочего push)

1. Sim localdev поднят (`deploy/LOCALDEV.md`): app `:3000`, в `.env.local` заданы `FVKS_EVENTS_TOKEN` (≥16) и при желании `FVKS_EVENTS_SIGNING_SECRET`.
2. Если FVKS не видит `localhost` — `bb connect expose 3000` и брать публичный URL как `{APP_URL}`.
3. Собрать Callback **целиком** (см. §2); значение токена не светить в чат.
4. У оператора meet/fvcs: обновить **`FVKS_MCP_HUB_EVENTS_URL`** **или** поле events URL у клиента `FM AI Hub` в админке (админка побеждает секрет).
5. Перезапуск затронутых meet-подов при смене секрета (`meet-backend` / `meet-mcp` / `meet-celery` — см. FVKS `deploy/GITHUB_SECRETS.md`).
6. Connect на Sim: `POST /api/fvks/connect` → `grant_id` (после `/2c` secrets).  
   Deploy workflow с FVKS trigger: **grant подставится из connection**, если поле пустое; иначе вставить `grant_id` вручную.
7. Smoke push: событие meet (напр. `recording.stopped` / любая запись с `events:receive`) → Sim лог `FvksWebhookIngress` `dispatched ≥ 1`, workflow run.
8. (Опционально) догон после искусственного простоя: `POST /api/fvks/events/catch-up` (сессия) или cron `GET /api/cron/fvks-events-catch-up` с `CRON_SECRET`.

Пока FMAH жив: **не** переключать prod events URL; localdev — отдельный клиент/стенд или временный admin URL.

---

## 4. Чеклист prod (только после паритета + «погнали»)

1. Sim prod с тем же контрактом; в `hub-secrets` / env: `FVKS_EVENTS_TOKEN`, опц. signing.
2. Callback = prod шаблон §2.
3. Обновить GitHub/meet secret `FVKS_MCP_HUB_EVENTS_URL` (и/или admin events URL).
4. Ротация: сначала новый URL принимает трафик; старый FMAH URL снять после проверки.
5. `AGENT_HUB_*` **не** трогать в этом slice.
6. Verify: одно реальное событие → run на `hub.fm.flomni.ru`; catch-up cron включён, если хаб может простаивать >~40 мин.

---

## 5. Дыры vs FMAH (этот slice)

| Тема | FMAH | Sim после `/2d` | localdev push |
| --- | --- | --- | --- |
| Ingress + path token (+ HMAC) | done | done | достаточно |
| Route by `grant_id` | Connection auto | deploy: auto из `/2c` connection **или** ручной `grantId` | достаточно |
| Журнал Event / audience / Dispatch | done | нет (упрощение) | ок для MVP |
| `list_events` catch-up | worker cron | `lib/fvks/catch-up` + cron/API; cursor в connection | не нужен для happy-path push; нужен после простоя >~40 мин |
| Agents API / `AGENT_HUB_*` | done | `/2e` | вне скоупа |

---

## 6. Код / ссылки

| Путь | Роль |
| --- | --- |
| `apps/sim/app/api/webhooks/fvks/[token]/route.ts` | ingress |
| `apps/sim/lib/webhooks/providers/fvks.ts` | verify + grant routing key |
| `apps/sim/lib/fvks/connection-store.ts` | grant → userId, cursor |
| `apps/sim/lib/fvks/catch-up.ts` | MCP `list_events` → тот же fan-out |
| `apps/sim/app/api/fvks/events/catch-up/route.ts` | ручной догон (сессия) |
| `apps/sim/app/api/cron/fvks-events-catch-up/route.ts` | cron догон |
| `deploy/LOCALDEV.md` | стенд |
| `deploy/CUTOVER-fmah-to-sim.md` | uninstall FMAH — не здесь |

*Карточка `/2d`, 2026-11-05.*
