# /3 Процесс: Install агента по ссылке (App Store)

Продукт снаружи: FM AI Hub. Каталога/поиска нет. Издать может любой.

## Скрипт

1. **Author** собирает workflow в своём workspace, делает **Publish** → `AgentRelease` (снимок без секретов).
2. Система выдаёт **share link** (token).
3. **User** открывает link → экран «Поставить себе» (не fork).
4. **Install** → `Installation` у User: свои credentials / OAuth согласия.
5. **Run** → Identity = User.
6. Author публикует Release N+1 → у Installation «есть обновление».
7. User **Accept / Defer**.
8. **Revoke** Installation — издание у других живо.

## Сущности

| Сущность | Назначение |
| --- | --- |
| AgentListing | опционально позже; сейчас достаточно link |
| AgentRelease | иммутабельная версия издания |
| Installation | экземпляр у User |
| UpdatePolicy | pending / accepted / deferred |
| Identity | run = установивший |

## As-is Sim (gap)

- Есть: workspace invite, fork, deploy chat/API, credential grants.
- Нет: Publish→Install по ссылке с каналом обновлений и Identity=installer по умолчанию.
- Fork ≠ App Store (нет обновлений).
- Deployed chat ≠ Install (нет своего экземпляра / часто owner identity).

Детальная карта API-хуков: [`docs/deploy/as-is-sim-api-hooks.md`](../docs/deploy/as-is-sim-api-hooks.md).

## Первый срез реализации (порядок)

1. Модель данных Release + Installation (+ token link)
2. API: publish, resolve link, install, list updates, accept/defer
3. UI: одна страница link → Install; бейдж обновлений
4. Runtime: bind credentials установившего
5. Не блокировать runtime k8s: можно разрабатывать на стенде после ns hub

Чеклист задач MVP: [`docs/deploy/mvp-install-slice.md`](../docs/deploy/mvp-install-slice.md).

## Вне скоупа среза

Каталог/поиск, UI kit redesign, FMAH.
