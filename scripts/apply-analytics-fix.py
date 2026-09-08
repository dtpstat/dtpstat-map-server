from pathlib import Path


def replace(path, old, new, count=1):
    file = Path(path)
    text = file.read_text()
    actual = text.count(old)
    if actual != count:
        raise SystemExit(f'{path}: expected {count} occurrences, found {actual}')
    file.write_text(text.replace(old, new, count))


app_path = Path('src/app.js')
app = app_path.read_text()
marker = "const CITY_MARKER_PNG = Buffer.from(CITY_MARKER_ICON.split(',')[1], 'base64');\n"
if marker not in app:
    raise SystemExit('src/app.js: CSP constants insertion marker missing')
constants = """const CITY_MARKER_PNG = Buffer.from(CITY_MARKER_ICON.split(',')[1], 'base64');

// Keep this list aligned with Yandex Metrica's published CSP requirements.
// The collector can switch between regional mc.yandex.* endpoints, while
// Session Replay also uses mc.webvisor.* and websocket connections.
const YANDEX_METRIKA_HTTPS_ORIGINS = Object.freeze([
  'https://mc.yandex.ru',
  'https://mc.yandex.az',
  'https://mc.yandex.by',
  'https://mc.yandex.co.il',
  'https://mc.yandex.com',
  'https://mc.yandex.com.am',
  'https://mc.yandex.com.ge',
  'https://mc.yandex.com.tr',
  'https://mc.yandex.ee',
  'https://mc.yandex.fr',
  'https://mc.yandex.kg',
  'https://mc.yandex.kz',
  'https://mc.yandex.lt',
  'https://mc.yandex.lv',
  'https://mc.yandex.md',
  'https://mc.yandex.tj',
  'https://mc.yandex.tm',
  'https://mc.yandex.uz',
  'https://mc.webvisor.com',
  'https://mc.webvisor.org',
  'https://yastatic.net',
]);
const YANDEX_METRIKA_WSS_ORIGINS = Object.freeze([
  'wss://mc.yandex.ru',
  'wss://mc.yandex.az',
  'wss://mc.yandex.by',
  'wss://mc.yandex.co.il',
  'wss://mc.yandex.com',
  'wss://mc.yandex.com.am',
  'wss://mc.yandex.com.ge',
  'wss://mc.yandex.com.tr',
  'wss://mc.yandex.ee',
  'wss://mc.yandex.fr',
  'wss://mc.yandex.kg',
  'wss://mc.yandex.kz',
  'wss://mc.yandex.lt',
  'wss://mc.yandex.lv',
  'wss://mc.yandex.md',
  'wss://mc.yandex.tj',
  'wss://mc.yandex.tm',
  'wss://mc.yandex.uz',
  'wss://mc.webvisor.com',
  'wss://mc.webvisor.org',
]);
const YANDEX_METRIKA_FRAME_ANCESTORS = Object.freeze([
  'metrika.yandex.ru',
  'analytics.yandex.by',
  'analytics.yandex.com',
  'analytics.yandex.com.tr',
  'analytics.yandex.kz',
  'analytics.yandex.ru',
  'metr.yandex.by',
  'metr.yandex.com',
  'metr.yandex.com.tr',
  'metr.yandex.kz',
  'metr.yandex.ru',
  'metrica.ya.ru',
  'metrica.yandex',
  'metrica.yandex.by',
  'metrica.yandex.com',
  'metrica.yandex.com.tr',
  'metrica.yandex.kz',
  'metrica.yandex.ru',
  'metrika.ya.ru',
  'metrika.yandex',
  'metrika.yandex.by',
  'metrika.yandex.com',
  'metrika.yandex.com.tr',
  'metrika.yandex.kz',
  'metrika.yandex.uz',
]);
"""
app = app.replace(marker, constants, 1)
old_csp = """          scriptSrc: [
            \"'self'\",
            \"'wasm-unsafe-eval'\",
            'https://mc.yandex.ru',
            'https://yastatic.net',
            'https://*.googletagmanager.com',
          ],
          styleSrc: [\"'self'\", \"'unsafe-inline'\"],
          imgSrc: [
            \"'self'\", 'data:', 'blob:', 'https://*.mapbox.com',
            'https://mc.yandex.ru', 'https://*.google-analytics.com',
            'https://*.googletagmanager.com',
          ],
          connectSrc: [
            \"'self'\", 'ws:', 'wss:', 'https://*.mapbox.com',
            'https://mc.yandex.ru', 'wss://mc.yandex.ru',
            'https://*.google-analytics.com', 'https://*.analytics.google.com',
            'https://*.googletagmanager.com',
          ],
          workerSrc: [\"'self'\", 'blob:'],
          childSrc: [\"'self'\", 'blob:', 'https://mc.yandex.ru'],
          frameSrc: [\"'self'\", 'blob:', 'https://mc.yandex.ru'],
"""
new_csp = """          scriptSrc: [
            \"'self'\",
            \"'wasm-unsafe-eval'\",
            ...YANDEX_METRIKA_HTTPS_ORIGINS,
            'https://*.googletagmanager.com',
          ],
          styleSrc: [\"'self'\", \"'unsafe-inline'\"],
          imgSrc: [
            \"'self'\", 'data:', 'blob:', 'https://*.mapbox.com',
            ...YANDEX_METRIKA_HTTPS_ORIGINS,
            'https://*.google-analytics.com',
            'https://*.googletagmanager.com',
          ],
          connectSrc: [
            \"'self'\", 'ws:', 'wss:', 'https://*.mapbox.com',
            ...YANDEX_METRIKA_HTTPS_ORIGINS,
            ...YANDEX_METRIKA_WSS_ORIGINS,
            'https://*.google-analytics.com', 'https://*.analytics.google.com',
            'https://*.googletagmanager.com',
          ],
          workerSrc: [\"'self'\", 'blob:'],
          childSrc: [\"'self'\", 'blob:', ...YANDEX_METRIKA_HTTPS_ORIGINS],
          frameSrc: [\"'self'\", 'blob:', ...YANDEX_METRIKA_HTTPS_ORIGINS],
          frameAncestors: [\"'self'\", ...YANDEX_METRIKA_FRAME_ANCESTORS],
"""
if app.count(old_csp) != 1:
    raise SystemExit('src/app.js: old CSP block not found exactly once')
app_path.write_text(app.replace(old_csp, new_csp, 1))

replace(
    'src/http/project-page.js',
    "    ? '<script type=\"module\" src=\"/js/metrics.js\"></script>'\n",
    "    ? '<script src=\"/js/metrics.js\"></script>'\n",
)

index = Path('index.html').read_text()
old_head = """    {{PROJECT_METRICS_META}}
    <title>{{PROJECT_NAME}}</title>
"""
new_head = """    {{PROJECT_METRICS_META}}
    {{PROJECT_METRICS_SCRIPT}}
    <title>{{PROJECT_NAME}}</title>
"""
if index.count(old_head) != 1:
    raise SystemExit('index.html: metrics head marker missing')
index = index.replace(old_head, new_head, 1)
old_bottom = """    <script src=\"/vendor/mapbox-gl/mapbox-gl.js\"></script>
    <script type=\"module\" src=\"/js/app.js\"></script>
    {{PROJECT_METRICS_SCRIPT}}
"""
new_bottom = """    <script src=\"/vendor/mapbox-gl/mapbox-gl.js\"></script>
    <script type=\"module\" src=\"/js/app.js\"></script>
"""
if index.count(old_bottom) != 1:
    raise SystemExit('index.html: old bottom metrics marker missing')
Path('index.html').write_text(index.replace(old_bottom, new_bottom, 1))

Path('public/js/metrics.js').write_text(r'''function metaContent(name) {
  return document.querySelector(`meta[name="${name}"]`)?.content?.trim() ?? '';
}

const metricsState = {
  yandex: {
    configured: false,
    initialized: false,
    ready: false,
    scriptStatus: 'disabled',
    scriptSrc: null,
    lastError: null,
  },
  google: {
    configured: false,
    initialized: false,
    ready: false,
    scriptStatus: 'disabled',
    scriptSrc: null,
    lastError: null,
  },
};

// Public, read-only-by-convention diagnostics for DevTools. Analytics IDs are
// already public browser identifiers; the state intentionally stores only
// loader status and URLs so a blocked script can be diagnosed immediately.
window.dtpstatMetrics = metricsState;

function publishStatus(provider) {
  window.dispatchEvent(new CustomEvent('dtpstat:metrics-status', {
    detail: {
      provider,
      state: { ...metricsState[provider] },
    },
  }));
}

function setScriptStatus(provider, status, src, error = null) {
  const state = metricsState[provider];
  state.scriptStatus = status;
  state.scriptSrc = src;
  state.lastError = error;
  publishStatus(provider);
}

function markInitialized(provider) {
  metricsState[provider].initialized = true;
  publishStatus(provider);
}

function markReady(provider) {
  metricsState[provider].ready = true;
  publishStatus(provider);
}

function appendScript(src, provider, onLoad) {
  const existing = document.querySelector(`script[data-metrics-provider="${provider}"]`);
  if (existing) return existing;

  const script = document.createElement('script');
  script.async = true;
  script.src = src;
  script.dataset.metricsProvider = provider;
  script.addEventListener('load', () => {
    setScriptStatus(provider, 'loaded', src);
    onLoad?.();
  }, { once: true });
  script.addEventListener('error', () => {
    const message = `Failed to load ${provider} analytics script`;
    setScriptStatus(provider, 'error', src, message);
    console.warn(`[dtpstat metrics] ${message}: ${src}`);
  }, { once: true });
  setScriptStatus(provider, 'loading', src);
  document.head.append(script);
  return script;
}

function startYandexMetrika(counterId) {
  if (!/^[1-9][0-9]{0,14}$/.test(counterId)) return;
  metricsState.yandex.configured = true;

  window.ym = window.ym || function yandexMetrikaQueue() {
    (window.ym.a = window.ym.a || []).push(arguments);
  };
  window.ym.l = window.ym.l || Date.now();

  const readyEvent = `yacounter${counterId}inited`;
  document.addEventListener(readyEvent, () => markReady('yandex'), { once: true });
  appendScript('https://mc.yandex.ru/metrika/tag.js', 'yandex');
  window.ym(Number(counterId), 'init', {
    clickmap: true,
    trackLinks: true,
    accurateTrackBounce: true,
    webvisor: true,
    triggerEvent: true,
  });
  markInitialized('yandex');
}

function startGoogleAnalytics(measurementId) {
  if (!/^G-[A-Z0-9]{4,32}$/.test(measurementId)) return;
  metricsState.google.configured = true;

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function googleAnalyticsQueue() {
    window.dataLayer.push(arguments);
  };

  const src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  appendScript(src, 'google', () => markReady('google'));
  window.gtag('js', new Date());
  window.gtag('config', measurementId);
  markInitialized('google');
}

const yandexMetrikaId = metaContent('yandex-metrika-id');
const googleAnalyticsId = metaContent('google-analytics-id').toUpperCase();

if (yandexMetrikaId) startYandexMetrika(yandexMetrikaId);
if (googleAnalyticsId) startGoogleAnalytics(googleAnalyticsId);
''')

api_path = Path('test/api.test.js')
api = api_path.read_text()
old_create = """    adminTasks: options.adminTasks,
    repository: options.repository ?? createTestRepository(),
    importService,
"""
new_create = """    adminTasks: options.adminTasks,
    repository: options.repository ?? createTestRepository(),
    projectSettingsRepository: options.projectSettingsRepository,
    importService,
"""
if api.count(old_create) != 1:
    raise SystemExit('test/api.test.js: createApp option marker missing')
api = api.replace(old_create, new_create, 1)
insert_before = "test('geometry endpoint validates IDs and returns a FeatureCollection', async () => {"
analytics_test = r'''test('public page emits analytics markup and a CSP that permits configured collectors', async () => {
  const projectSettingsRepository = {
    async get() {
      return {
        projectName: 'Analytics test',
        keywords: ['analytics'],
        footerHtml: '<p>Analytics</p>',
        yandexMetrikaId: '12345678',
        googleAnalyticsId: 'G-AB12CD34EF',
        themePreset: 'classic',
        showLineLabels: false,
        showLinePopups: true,
        publicDownloadName: 'analytics-test',
        updatedAt: '2026-09-08T00:00:00.000Z',
      };
    },
    async save(payload) { return payload; },
  };

  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/`);
    assert.equal(response.status, 200);
    const html = await response.text();
    const csp = response.headers.get('content-security-policy') ?? '';

    assert.match(html, /name="yandex-metrika-id" content="12345678"/);
    assert.match(html, /name="google-analytics-id" content="G-AB12CD34EF"/);
    assert.match(html, /<script src="\/js\/metrics\.js"><\/script>/);
    assert.ok(html.indexOf('/js/metrics.js') < html.indexOf('</head>'));
    assert.ok(html.indexOf('/js/metrics.js') < html.indexOf('/js/app.js'));

    assert.match(csp, /script-src[^;]*https:\/\/mc\.yandex\.ru/);
    assert.match(csp, /script-src[^;]*https:\/\/mc\.yandex\.com/);
    assert.match(csp, /script-src[^;]*https:\/\/mc\.webvisor\.org/);
    assert.match(csp, /script-src[^;]*https:\/\/yastatic\.net/);
    assert.match(csp, /script-src[^;]*https:\/\/\*\.googletagmanager\.com/);
    assert.match(csp, /connect-src[^;]*wss:\/\/mc\.webvisor\.org/);
    assert.match(csp, /connect-src[^;]*https:\/\/\*\.google-analytics\.com/);
    assert.match(csp, /connect-src[^;]*https:\/\/\*\.analytics\.google\.com/);
    assert.match(csp, /frame-src[^;]*https:\/\/mc\.webvisor\.com/);
    assert.match(csp, /frame-ancestors[^;]*metrika\.yandex\.ru/);
    assert.match(csp, /frame-ancestors[^;]*analytics\.yandex\.com/);
  }, { projectSettingsRepository });
});

'''
if api.count(insert_before) != 1:
    raise SystemExit('test/api.test.js: analytics test insertion marker missing')
api_path.write_text(api.replace(insert_before, analytics_test + insert_before, 1))

page_test_path = Path('test/project-page.test.js')
page_test = page_test_path.read_text()
old_assert = """  assert.match(both, /src=\"https:\\/\\/mc\\.yandex\\.ru\\/watch\\/12345678\"/);
  assert.equal((both.match(/src=\"\\/js\\/metrics\\.js\"/g) ?? []).length, 1);
"""
new_assert = """  assert.match(both, /src=\"https:\\/\\/mc\\.yandex\\.ru\\/watch\\/12345678\"/);
  assert.equal((both.match(/<script src=\"\\/js\\/metrics\\.js\"><\\/script>/g) ?? []).length, 1);
  assert.doesNotMatch(both, /type=\"module\" src=\"\\/js\\/metrics\\.js\"/);
"""
if page_test.count(old_assert) != 1:
    raise SystemExit('test/project-page.test.js: analytics assertion marker missing')
page_test_path.write_text(page_test.replace(old_assert, new_assert, 1))

ui_test_path = Path('test/project-ui-integration.test.js')
ui_test = ui_test_path.read_text()
old_ui = """  assert.match(app, /https:\\/\\/mc\\.yandex\\.ru/);
  assert.match(app, /https:\\/\\/\\*\\.googletagmanager\\.com/);
"""
new_ui = """  assert.match(app, /https:\\/\\/mc\\.yandex\\.ru/);
  assert.match(app, /https:\\/\\/mc\\.yandex\\.com/);
  assert.match(app, /wss:\\/\\/mc\\.webvisor\\.org/);
  assert.match(app, /YANDEX_METRIKA_FRAME_ANCESTORS/);
  assert.match(app, /frameAncestors/);
  assert.match(app, /https:\\/\\/\\*\\.googletagmanager\\.com/);
"""
if ui_test.count(old_ui) != 1:
    raise SystemExit('test/project-ui-integration.test.js: CSP assertions marker missing')
ui_test = ui_test.replace(old_ui, new_ui, 1)
old_metrics_assert = """  assert.match(metrics, /metaContent\\('yandex-metrika-id'\\)/);
  assert.match(metrics, /metaContent\\('google-analytics-id'\\)/);
"""
new_metrics_assert = """  assert.match(metrics, /metaContent\\('yandex-metrika-id'\\)/);
  assert.match(metrics, /metaContent\\('google-analytics-id'\\)/);
  assert.match(metrics, /webvisor: true/);
  assert.match(metrics, /triggerEvent: true/);
  assert.match(metrics, /window\\.dtpstatMetrics = metricsState/);
  assert.match(metrics, /dtpstat:metrics-status/);
  assert.match(metrics, /script\\.addEventListener\\('error'/);
  assert.ok(html.indexOf('{{PROJECT_METRICS_SCRIPT}}') < html.indexOf('</head>'));
"""
if ui_test.count(old_metrics_assert) != 1:
    raise SystemExit('test/project-ui-integration.test.js: loader assertions marker missing')
ui_test_path.write_text(ui_test.replace(old_metrics_assert, new_metrics_assert, 1))

readme_path = Path('README.md')
readme = readme_path.read_text()
capability = '- настраиваемое базовое имя публичных GeoJSON/CSV;\n'
if capability not in readme:
    raise SystemExit('README.md: capability marker missing')
readme = readme.replace(
    capability,
    capability + '- DB-backed Yandex Metrica и Google Analytics 4 с CSP-safe ранней загрузкой;\n',
    1,
)
settings_marker = """`SHOW_LINE_LABELS` и `SHOW_LINE_POPUPS` независимы.

### Публичные GeoJSON/CSV
"""
settings_replacement = """`SHOW_LINE_LABELS` и `SHOW_LINE_POPUPS` независимы.

Analytics IDs подключаются только когда заданы. Счётчики загружаются ранним внешним скриптом в `<head>`; CSP разрешает официальные endpoints Yandex Metrica/Session Replay и GA4. Диагностика загрузчиков доступна в браузере через `window.dtpstatMetrics`. Подробнее: [docs/analytics.md](docs/analytics.md).

### Публичные GeoJSON/CSV
"""
if readme.count(settings_marker) != 1:
    raise SystemExit('README.md: project settings marker missing')
readme_path.write_text(readme.replace(settings_marker, settings_replacement, 1))

Path('docs/analytics.md').write_text(r'''# Yandex Metrica и Google Analytics 4

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
''')
