import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

async function source(relativePath) {
  return fs.readFile(path.join(projectRoot, relativePath), 'utf8');
}

test('project settings migrations create branding, metrics, theme and line popup settings', async () => {
  const [baseSql, metricsSql, limitSql, themeSql, popupSql] = await Promise.all([
    source('db/migrations/V009__project_settings.sql'),
    source('db/migrations/V010__project_metrics.sql'),
    source('db/migrations/V011__limit_yandex_metrika_id.sql'),
    source('db/migrations/V021__public_theme_preset.sql'),
    source('db/migrations/V022__line_popup_setting.sql'),
  ]);

  assert.match(baseSql, /CREATE TABLE IF NOT EXISTS BUSLANES\.PROJECT_SETTINGS/i);
  assert.match(baseSql, /CHECK \(ID = 1\)/i);
  assert.match(baseSql, /PROJECT_NAME TEXT/i);
  assert.match(baseSql, /KEYWORDS\s+TEXT\[\]/i);
  assert.match(baseSql, /FOOTER_HTML\s+TEXT/i);
  assert.match(baseSql, /'Выделенные полосы в России'/);

  assert.match(metricsSql, /YANDEX_METRIKA_ID TEXT/i);
  assert.match(metricsSql, /GOOGLE_ANALYTICS_ID TEXT/i);
  assert.match(metricsSql, /YANDEX_METRIKA_ID ~ '\^\[1-9\]\[0-9\]\{0,19\}\$'/i);
  assert.match(metricsSql, /GOOGLE_ANALYTICS_ID IS NULL/i);

  assert.match(limitSql, /DROP CONSTRAINT IF EXISTS PROJECT_SETTINGS_YANDEX_METRIKA_ID_CHECK/i);
  assert.match(limitSql, /YANDEX_METRIKA_ID ~ '\^\[1-9\]\[0-9\]\{0,14\}\$'/i);

  assert.match(themeSql, /THEME_PRESET TEXT NOT NULL DEFAULT 'classic'/i);
  assert.match(themeSql, /THEME_PRESET IN \('retro', 'classic', 'modern'\)/i);
  assert.match(popupSql, /SHOW_LINE_POPUPS BOOLEAN NOT NULL DEFAULT TRUE/i);
});

test('admin interface exposes project settings and independent line display switches', async () => {
  const [shell, editor, css] = await Promise.all([
    source('admin/admin-shell.js'),
    source('admin/project-settings-editor.js'),
    source('admin/project-settings.css'),
  ]);

  assert.match(shell, /import\('\.\/project-settings-editor\.js'\)/);
  assert.match(shell, /import\('\.\/report-config-editor\.js'\)/);
  assert.match(editor, /dataset\.interfaceTab = 'project'/);
  assert.match(editor, /dataset\.interfacePanel = 'project'/);
  assert.match(editor, /name="projectName"/);
  assert.match(editor, /name="themePreset" type="radio" value="retro"/);
  assert.match(editor, /name="themePreset" type="radio" value="classic"/);
  assert.match(editor, /name="themePreset" type="radio" value="modern"/);
  assert.match(editor, /themePreset: themePreset\.value/);
  assert.match(editor, /name="showLineLabels" type="checkbox"/);
  assert.match(editor, /name="showLinePopups" type="checkbox"/);
  assert.match(editor, /showLineLabels: showLineLabels\.checked/);
  assert.match(editor, /showLinePopups: showLinePopups\.checked/);
  assert.match(editor, /name="keywords"/);
  assert.match(editor, /name="yandexMetrikaId"/);
  assert.match(editor, /name="googleAnalyticsId"/);
  assert.match(editor, /name="footerHtml"/);
  assert.match(editor, /data-project-snippet="callout"/);
  assert.match(editor, /data-project-snippet="columns"/);
  assert.match(editor, /\/api\/admin\/project-settings/);
  assert.match(css, /\.project-theme-grid/);
  assert.match(css, /data-theme-preview/);
});

test('public page derives metadata, theme stylesheet and analytics loaders from project settings', async () => {
  const [html, app, metrics, contentCss, retroCss, classicCss, modernCss] = await Promise.all([
    source('index.html'),
    source('src/app.js'),
    source('public/js/metrics.js'),
    source('public/css/project-content.css'),
    source('public/css/themes/retro.css'),
    source('public/css/themes/classic.css'),
    source('public/css/themes/modern.css'),
  ]);

  for (const marker of [
    '<title>{{PROJECT_NAME}}</title>',
    'name="application-name" content="{{PROJECT_NAME}}"',
    'name="apple-mobile-web-app-title" content="{{PROJECT_NAME}}"',
    'property="og:title" content="{{PROJECT_NAME}}"',
    'property="og:site_name" content="{{PROJECT_NAME}}"',
    'name="twitter:title" content="{{PROJECT_NAME}}"',
    '<h1 id="page-title">{{PROJECT_NAME}}</h1>',
  ]) {
    assert.ok(html.includes(marker), marker);
  }
  assert.match(html, /data-theme="\{\{PROJECT_THEME_NAME\}\}"/);
  assert.match(html, /\{\{PROJECT_THEME_STYLESHEET\}\}/);
  assert.match(html, /name="keywords" content="\{\{PROJECT_KEYWORDS\}\}"/);
  assert.match(html, /\{\{PROJECT_METRICS_META\}\}/);
  assert.match(html, /\{\{PROJECT_METRICS_SCRIPT\}\}/);
  assert.match(html, /\{\{YANDEX_METRIKA_NOSCRIPT\}\}/);
  assert.match(html, /\{\{PROJECT_FOOTER_HTML\}\}/);
  assert.match(html, /\/css\/project-content\.css/);
  assert.match(app, /projectManifest\(settings\)/);
  assert.match(app, /renderProjectPage\(publicPageTemplate, settings\)/);
  assert.match(app, /https:\/\/mc\.yandex\.ru/);
  assert.match(app, /https:\/\/\*\.googletagmanager\.com/);
  assert.match(metrics, /https:\/\/mc\.yandex\.ru\/metrika\/tag\.js/);
  assert.match(metrics, /https:\/\/www\.googletagmanager\.com\/gtag\/js/);
  assert.match(metrics, /metaContent\('yandex-metrika-id'\)/);
  assert.match(metrics, /metaContent\('google-analytics-id'\)/);
  assert.match(contentCss, /\.project-callout/);
  assert.match(contentCss, /\.project-columns/);
  assert.match(contentCss, /\.project-link-button/);
  assert.match(retroCss, /--selected:\s*#fff400/i);
  assert.match(classicCss, /--selected:\s*#ffdf75/i);
  assert.match(modernCss, /--selected:\s*#e5eee3/i);
});

test('public map reloads independent line display settings without a page refresh', async () => {
  const [publicApp, mapController] = await Promise.all([
    source('public/js/app.js'),
    source('public/js/map-controller.js'),
  ]);

  assert.match(publicApp, /showLineLabels: Boolean\(projectSettings\.showLineLabels\)/);
  assert.match(publicApp, /showLinePopups: projectSettings\.showLinePopups !== false/);
  assert.match(publicApp, /refreshLineDisplayOptions/);
  assert.match(publicApp, /mapController\.setLineDisplayOptions/);
  assert.match(mapController, /let showLineLabels = Boolean\(config\.showLineLabels\)/);
  assert.match(mapController, /let showLinePopups = config\.showLinePopups !== false/);
  assert.match(mapController, /if \(!showLinePopups\)/);
  assert.match(mapController, /setLineDisplayOptions\(options = \{\}\)/);
});

test('retro table hides the low-zoom hint and uses zebra striping', async () => {
  const [publicApp, cityList, retroCss] = await Promise.all([
    source('public/js/app.js'),
    source('public/js/city-list.js'),
    source('public/css/themes/retro.css'),
  ]);

  assert.doesNotMatch(publicApp, /Выберите город или увеличьте карту для показа линий/);
  assert.match(publicApp, /cityList\.setStatus\(''\)/);
  assert.match(cityList, /elements\.status\.hidden = !message/);
  assert.match(retroCss, /tbody tr:nth-child\(odd\)/);
  assert.match(retroCss, /tbody tr:nth-child\(even\)/);
  assert.match(retroCss, /tbody tr\.is-active/);
});
