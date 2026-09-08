import { publicDownloadFiles } from '../data/public-download-name.js';

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const THEME_STYLESHEETS = Object.freeze({
  retro: '/css/themes/retro.css',
  classic: '/css/themes/classic.css',
  modern: '/css/themes/modern.css',
});

function themeMarkup(settings) {
  const themePreset = Object.hasOwn(THEME_STYLESHEETS, settings.themePreset)
    ? settings.themePreset
    : 'classic';
  return {
    name: themePreset,
    stylesheet: `<link rel="stylesheet" href="${THEME_STYLESHEETS[themePreset]}">`,
  };
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
    ? '<script src="/js/metrics.js"></script>'
    : '';
  const yandexNoScript = yandexMetrikaId
    ? `<img src="https://mc.yandex.ru/watch/${yandexMetrikaId}" alt="" hidden>`
    : '';

  return { meta, script, yandexNoScript };
}

function footerMarkup(settings) {
  const files = publicDownloadFiles(settings.publicDownloadName);
  return String(settings.footerHtml ?? '')
    .replaceAll('{{PUBLIC_GEOJSON_URL}}', files.geoJsonUrl)
    .replaceAll('{{PUBLIC_CSV_URL}}', files.csvUrl);
}

export function renderProjectPage(template, settings) {
  const projectName = escapeHtml(settings.projectName);
  const keywords = escapeHtml((settings.keywords ?? []).join(', '));
  const metrics = metricsMarkup(settings);
  const theme = themeMarkup(settings);
  return template
    .replaceAll('{{PROJECT_NAME}}', projectName)
    .replaceAll('{{PROJECT_KEYWORDS}}', keywords)
    .replaceAll('{{PROJECT_THEME_NAME}}', theme.name)
    .replace('{{PROJECT_THEME_STYLESHEET}}', theme.stylesheet)
    .replace('{{PROJECT_METRICS_META}}', metrics.meta)
    .replace('{{PROJECT_FOOTER_HTML}}', footerMarkup(settings))
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
