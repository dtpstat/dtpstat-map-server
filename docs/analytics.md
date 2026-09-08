# Yandex Metrica и Google Analytics 4

Analytics настраивается в web-admin:

```text
Настройка интерфейса → Проект → Идентификаторы и API
```

Хранение:

```text
PROJECT_SETTINGS.YANDEX_METRIKA_ID
PROJECT_SETTINGS.GOOGLE_ANALYTICS_ID
```

Пустой ID полностью отключает соответствующий collector.

## Форматы ID

Yandex Metrica:

```text
положительный числовой ID, до 15 цифр
```

Google Analytics 4:

```text
G-XXXXXXXXXX
```

Старые Universal Analytics `UA-...` не поддерживаются.

## Порядок загрузки

`GET /` получает настройки проекта из БД и серверный renderer добавляет в `<head>` только необходимые meta-теги и один локальный loader:

```html
<meta name="yandex-metrika-id" content="12345678">
<meta name="google-analytics-id" content="G-AB12CD34EF">
<script src="/js/metrics.js"></script>
```

`metrics.js` выполняется до тяжёлого публичного приложения/Mapbox, сразу создаёт очереди `ym`/`dataLayer` и асинхронно подключает внешние библиотеки.

Yandex инициализируется с:

```text
clickmap=true
trackLinks=true
accurateTrackBounce=true
webvisor=true
triggerEvent=true
```

Google использует стандартную GA4 последовательность `gtag('js', ...)` + `gtag('config', measurementId)`.

## CSP

Приложение использует Helmet CSP. Для Yandex разрешён опубликованный Yandex набор региональных `mc.yandex.*`, `mc.webvisor.*`, `yastatic.net`, websocket endpoints и `frame-ancestors`, необходимые Session Replay/картам.

Для GA4 разрешены:

```text
https://*.googletagmanager.com
https://*.google-analytics.com
https://*.analytics.google.com
```

Список Yandex origins хранится централизованно в `src/app.js`; при изменении официальных требований его надо обновлять вместе с integration test.

## Диагностика в браузере

Loader публикует состояние:

```js
window.dtpstatMetrics
```

Пример нормального состояния после загрузки:

```js
{
  yandex: {
    configured: true,
    initialized: true,
    ready: true,
    scriptStatus: 'loaded'
  },
  google: {
    configured: true,
    initialized: true,
    ready: true,
    scriptStatus: 'loaded'
  }
}
```

`scriptStatus: 'error'` означает, что внешний JS не загрузился. Типовые причины:

- DNS/ad blocker;
- browser extension;
- сетевой firewall;
- CSP, если provider изменил свои endpoints.

Loader также отправляет browser event:

```text
dtpstat:metrics-status
```

и пишет `console.warn` при ошибке загрузки внешнего скрипта.

Для сетевой проверки в DevTools → Network должны присутствовать как минимум:

```text
Yandex: mc.yandex.ru/metrika/tag.js
Google: www.googletagmanager.com/gtag/js?id=G-...
```

После загрузки появляются collector requests к разрешённым analytics endpoints.

## Внешние блокировщики

DNS-фильтры и ad blockers часто намеренно блокируют `mc.yandex.ru`, `googletagmanager.com` и `google-analytics.com`. При проверке интеграции их надо временно отключить либо проводить тест из сети без такой фильтрации. Это не ошибка приложения.

## Проверка после изменения настроек

1. Сохранить IDs в админке.
2. Открыть публичную страницу в новом/private окне без блокировщиков.
3. Проверить `window.dtpstatMetrics`.
4. Проверить Network/Console.
5. Для GA4 смотреть Realtime.
6. Для Yandex проверить визиты и Session Replay после обработки данных сервисом.
