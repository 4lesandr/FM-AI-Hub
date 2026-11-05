# Deploy — FM AI Hub (FLOMNI)

Продукт снаружи: **FM AI Hub**. Движок: этот форк Sim.  
Публичный URL: `https://hub.fm.flomni.ru` · Kubernetes namespace: `hub` (рядом с `meet`).

## Решения (процесс)

- Кластер тот же, что FM Встречи (`FVKS/deploy`, `kfvks`).
- Выкладка уровня Встреч: кнопка CI, не auto с push; гейты — по возможности как FVKS.
- White-label минимум: `NEXT_PUBLIC_BRAND_NAME=FM AI Hub` (+ logo/favicon).
- Слово Sim в UI не светить; UI kit — позже.
- После стабильного runtime — Install агентов по ссылке (этап /3).

## Структура (каркас этапа /1)

```
deploy/
  README.md           этот файл
  tenants/flomni.yaml заготовка values / контур Flomni
```

Чарт приложения: upstream `helm/sim` в корне репо. Overlay и CI FLOMNI наращиваем на этапе /2.

## Не здесь

- DNS / сертификаты (ops кластера)
- Клиент Keycloak
- Полноценный CI pipeline
- Продукт Install по ссылке
