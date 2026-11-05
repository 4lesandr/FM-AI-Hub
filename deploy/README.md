# Deploy — FM AI Hub (FLOMNI)

Продукт: **FM AI Hub** · URL: `https://hub.fm.flomni.ru` · ns: `hub` (кластер Встреч).

Репо: `github.com/4lesandr/FM-AI-Hub` · ветка работы: `feat/fm-mvp`.

## Уже решено

- k8s рядом с meet, не VM хаба
- White-label: `NEXT_PUBLIC_BRAND_NAME=FM AI Hub`
- Тяжёлые сборки — Modal; локальный type-check на Air запрещён
- Next-артефакт: `BUILD_ID=qYe2j_9dW8uBe6t4XPi2L` (`apps/sim/.next`, `stand/artifacts/sim-next-build.tgz`)

## Структура

```
deploy/
  README.md
  tenants/flomni.yaml       # контур / OIDC заметки
  helm/values-flomni.yaml   # overlay на helm/sim
```

Чарт: `helm/sim` в корне репо.

## Порядок выкладки (/2)

1. DNS `hub.fm.flomni.ru` → ingress кластера
2. Keycloak client в `fteam` (redirect под Sim SSO callback; не ломать старый `hub` на VM до cutover)
3. Secret `hub-secrets` в ns `hub` (BETTER_AUTH_SECRET, ENCRYPTION_KEY, …)
4. `helm upgrade --install fm-ai-hub ./helm/sim -n hub -f deploy/helm/values-flomni.yaml`
5. Включить SSO_* после регистрации IdP
6. Verify: health, SSO login, websocket, бренд в UI
7. Invite сотрудников

CI (кнопка, не push→prod) — следующий шаг в этом этапе.

## Mac

Не запускать `bun run type-check` / `turbo type-check` локально. Push: `HUSKY=0 git push` если хук тянет type-check.
