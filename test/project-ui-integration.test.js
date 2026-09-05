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

test('project settings migrations create singleton branding and version metric constraint changes', async () => {
  const [baseSql, metricsSql, limitSql] = await Promise.all([
    source('db/migrations/V009__project_settings.sql'),
    source('db/migrations/V010__project_metrics.sql'),
    source('db/migrations/V011__limit_yandex_metrika_id.sql'),
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
});

test('admin bootstraps a fourth Project tab with metadata metrics and restricted HTML editor', async () => {
  const [notices, editor, css] = await Promise.all([
    source('admin/task-notices.js'),
    source('admin/project-settings-editor.js'),
    source('admin/project-settings.css'),
  ]);

  assert.match(notices, /import '\.\/project-settings-editor\.js'/);
  assert.match(editor, /dataset\.taskTab = 'project'/);
  assert.match(editor, /data-operation-tab="project-settings"/);
  assert.match(editor, /name="projectName"/);
  assert.match(editor, /name="keywords"/);
  assert.match(editor, /name="yandexMetrikaId"/);
  assert.match(editor, /name="googleAnalyticsId"/);
  assert.match(editor, /name="footerHtml"/);
  assert.match(editor, /data-project-snippet="callout"/);
  assert.match(editor, /data-project-snippet="columns"/);
  assert.match(editor, /\/api\/admin\/project-settings/);
  assert.match(css, /grid-template-columns: repeat\(4,/);
  assert.match(css, /\.project-metrics-grid/);
});

test('public page derives title metadata and analytics loaders from project settings', async () => {
  const [html, app, metrics, css] = await Promise.all([
    source('index.html'),
    source('src/app.js'),
    source('public/js/metrics.js'),
    source('public/css/project-content.css'),
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
  assert.match(css, /\.project-callout/);
  assert.match(css, /\.project-columns/);
  assert.match(css, /\.project-link-button/);
});
