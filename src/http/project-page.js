function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function metricsMarkup(settings) {
  const yandexMetrikaId = settings.yandexMetrikaId
    ? escapeHtml(settings.yandexMetrikaId)
    : '';
  const googleAnalyticsId = settings.googleAnalyticsId
    ? escapeHtml(settings.googleAnalyticsId)
    : '';
  const meta = [
    yandexMetrikaId
      ? `<meta name="yandex-metrika-id" content="${yandexMetrikaId}">`
      : '',
    googleAnalyticsId
      ? `<meta name="google-analytics-id" content="${googleAnalyticsId}">`
      : '',
  ].filter(Boolean).join('\n    ');
  const script = yandexMetrikaId || googleAnalyticsId
    ? '<script type="module" src="/js/metrics.js"></script>'
    : '';
  const yandexNoScript = yandexMetrikaId
    ? `<img src="https://mc.yandex.ru/watch/${yandexMetrikaId}" alt="" hidden>`
    : '';

  return { meta, script, yandexNoScript };
}

export function renderProjectPage(template, settings) {
  const projectName = escapeHtml(settings.projectName);
  const keywords = escapeHtml((settings.keywords ?? []).join(', '));
  const metrics = metricsMarkup(settings);
  return template
    .replaceAll('{{PROJECT_NAME}}', projectName)
    .replaceAll('{{PROJECT_KEYWORDS}}', keywords)
    .replace('{{PROJECT_METRICS_META}}', metrics.meta)
    .replace('{{PROJECT_FOOTER_HTML}}', settings.footerHtml)
    .replace('{{YANDEX_METRIKA_NOSCRIPT}}', metrics.yandexNoScript)
    .replace('{{PROJECT_METRICS_SCRIPT}}', metrics.script);
}

export function projectManifest(settings) {
  return {
    name: settings.projectName,
    short_name: settings.projectName,
    icons: [
      {
        src: '/android-chrome-192x192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/android-chrome-512x512.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
    theme_color: '#ffffff',
    background_color: '#ffffff',
    display: 'standalone',
  };
}
