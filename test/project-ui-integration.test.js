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

test('project settings migrations create branding, metrics, theme, line popup and dynamic download-name settings', async () => {
  const [
    baseSql,
    metricsSql,
    limitSql,
    themeSql,
    popupSql,
    downloadNameSql,
    dynamicLinksSql,
    historySql,
  ] = await Promise.all([
    source('db/migrations/V009__project_settings.sql'),
    source('db/migrations/V010__project_metrics.sql'),
    source('db/migrations/V011__limit_yandex_metrika_id.sql'),
    source('db/migrations/V021__public_theme_preset.sql'),
    source('db/migrations/V022__line_popup_setting.sql'),
    source('db/migrations/V025__public_download_name.sql'),
    source('db/migrations/V026__dynamic_public_download_links.sql'),
    source('db/migrations/V061__geometry_history_mode.sql'),
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
  assert.match(downloadNameSql, /PUBLIC_DOWNLOAD_NAME TEXT NOT NULL DEFAULT 'bus-lanes'/i);
  assert.match(downloadNameSql, /PROJECT_SETTINGS_PUBLIC_DOWNLOAD_NAME_CHECK/i);
  assert.match(dynamicLinksSql, /\{\{PUBLIC_GEOJSON_URL\}\}/);
  assert.match(dynamicLinksSql, /\{\{PUBLIC_CSV_URL\}\}/);
  assert.match(dynamicLinksSql, /Base name used for materialized public GeoJSON\/CSV files, URLs and download names/i);

  assert.match(historySql, /ADD COLUMN IF NOT EXISTS HISTORY_START_DATE DATE/u);
  assert.match(historySql, /CREATE TABLE BUSLANES\.GEOMETRY_HISTORY_SPEEDS/u);
  assert.match(historySql, /'day'[\s\S]*'week'[\s\S]*'month'[\s\S]*'quarter'[\s\S]*'year'[\s\S]*'five_years'[\s\S]*'decade'/u);
  assert.match(historySql, /INTERVAL_SECONDS BETWEEN 0\.1 AND 60/u);
  assert.match(historySql, /GEOMETRY_HISTORY_SPEEDS_ONE_DEFAULT_UIDX/u);
  assert.match(historySql, /\('1x', 'month', 1\.0/u);
  assert.match(historySql, /\('10x', 'year', 0\.5/u);
});

test('admin interface loads editors and helpers explicitly without transitive side effects', async () => {
  const [
    shell,
    layout,
    layoutSchema,
    editor,
    transferEditor,
    downloadEditor,
    notices,
    branding,
    css,
    downloadCss,
  ] = await Promise.all([
    source('admin/admin-shell.js'),
    source('admin/admin-layout.js'),
    source('admin/admin-layout-schema.js'),
    source('admin/project-settings-editor.js'),
    source('admin/project-transfer-editor.js'),
    source('admin/public-download-name-editor.js'),
    source('admin/task-notices.js'),
    source('admin/project-branding.js'),
    source('admin/project-settings.css'),
    source('admin/public-download-name.css'),
  ]);

  for (const moduleName of [
    'project-settings-editor.js',
    'public-download-name-editor.js',
    'line-types-editor.js',
    'point-types-editor.js',
    'report-config-editor.js',
    'report-range-ui.js',
    'project-branding.js',
  ]) {
    assert.match(shell, new RegExp(`import\\('\\./${moduleName.replaceAll('.', '\\.')}'\\)`));
  }
  assert.doesNotMatch(notices, /-editor\.js/);
  assert.doesNotMatch(branding, /public-download-name-editor\.js/);

  assert.doesNotMatch(
    editor,
    /document\.createElement\(['"]button['"]\)[\s\S]*interface-tab-project|mapTab\.dataset\.interfaceTab/u,
  );
  assert.match(
    layoutSchema,
    /id:\s*'project'[\s\S]*elementId:[\s\S]*'operation-project-settings'[\s\S]*hostId:[\s\S]*'project-settings-editor-host'/u,
  );
  assert.match(
    layoutSchema,
    /id:\s*'project'[\s\S]*tabsHostId:[\s\S]*'project-settings-tabs'[\s\S]*tabsClass:[\s\S]*'project-settings-tabs'/u,
  );
  assert.match(
    layoutSchema,
    /id:\s*'project'[\s\S]*panelsHostId:[\s\S]*'project-settings-panels'[\s\S]*panelClass:[\s\S]*'project-settings-page'/u,
  );
  assert.match(
    layoutSchema,
    /id:\s*'map'[\s\S]*elementId:[\s\S]*'operation-map-settings'[\s\S]*hostId:[\s\S]*'map-settings-editor-host'/u,
  );
  assert.match(
    layoutSchema,
    /id:\s*'project-transfer'[\s\S]*permission:[\s\S]*'superuser'[\s\S]*hostId:[\s\S]*'project-transfer-editor-host'/u,
  );
  assert.match(
    transferEditor,
    /#project-transfer-editor-host/u,
  );
  assert.doesNotMatch(
    transferEditor,
    /interface-tabs|interface-panels|dataset\.interfaceTab|dataset\.interfacePanel/u,
  );
  assert.match(
    editor,
    /#project-settings-editor-host/u,
  );
  assert.match(
    editor,
    /#map-settings-editor-host/u,
  );
  assert.match(
    editor,
    /setupAdminTabGroup\(/u,
  );
  assert.match(
    editor,
    /adminInterfaceTabs\.find\([\s\S]*definition\.id ===[\s\S]*'project'/u,
  );
  assert.doesNotMatch(
    editor,
    /const selectProjectPanel|availableProjectTabs|projectTabs\.map/u,
  );
  assert.match(
    editor,
    /projectHost\.innerHTML/u,
  );
  assert.match(
    editor,
    /mapHost\.innerHTML/u,
  );
  assert.match(editor, /form="project-settings-form"/u);
  assert.match(editor, /Сохранить настройки карты/u);
  assert.match(
    editor,
    /ensureAdminTabGroup\([\s\S]*projectLayout\?\.tabs/u,
  );
  assert.doesNotMatch(
    editor,
    /<nav class="project-settings-tabs"|data-project-settings-tab="/u,
  );
  assert.match(
    editor,
    /#project-settings-general-host/u,
  );
  assert.match(editor, /id="project-settings-map"/u);
  assert.match(editor, /mapSettings\.removeAttribute\(\s*'data-project-settings-panel'/u);
  assert.match(
    editor,
    /mapSettingsHost\.append\([\s\S]*mapSettings\.childNodes/u,
  );
  assert.match(
    editor,
    /control\.setAttribute\([\s\S]*'form',[\s\S]*'project-settings-form'/u,
  );
  assert.match(
    editor,
    /#project-settings-metadata-host/u,
  );
  assert.match(
    editor,
    /#project-settings-footer-host/u,
  );
  assert.doesNotMatch(
    editor,
    /data-project-settings-source=|source\.content/u,
  );
  assert.match(editor, /name="projectName"/);
  assert.match(editor, /name="themePreset" type="radio" value="retro"/);
  assert.match(editor, /name="themePreset" type="radio" value="classic"/);
  assert.match(editor, /name="themePreset" type="radio" value="modern"/);
  assert.match(editor, /themePreset: themePreset\.value/);
  assert.match(editor, /name="showLineLabels" type="checkbox"/);
  assert.match(editor, /name="showLinePopups" type="checkbox"/);
  assert.match(editor, /name="showGeometryTimeline" type="checkbox"/);
  assert.match(editor, /Включить режим истории/u);
  assert.match(editor, /name="historyStartDate" type="date"/u);
  assert.match(editor, /id="project-history-speeds"/u);
  assert.match(editor, /id="project-history-speed-add"/u);
  assert.match(editor, /day: 'День'/u);
  assert.match(editor, /week: 'Неделя'/u);
  assert.match(editor, /month: 'Месяц'/u);
  assert.match(editor, /quarter: 'Квартал'/u);
  assert.match(editor, /five_years: 'Пятилетка'/u);
  assert.match(editor, /decade: 'Декада'/u);
  assert.match(editor, /name="showPointGeometries" type="checkbox"/);
  assert.match(editor, /name="showLineGeometries" type="checkbox"/);
  assert.match(editor, /name="showPolygonGeometries" type="checkbox"/);
  assert.match(editor, /showLineLabels: showLineLabels\.checked/);
  assert.match(editor, /showLinePopups: showLinePopups\.checked/);
  assert.match(editor, /showGeometryTimeline: showGeometryTimeline\.checked/);
  assert.match(editor, /historyStartDate: historyStartDate\.value \|\| null/u);
  assert.match(editor, /historySpeeds: readHistorySpeeds\(\)/u);
  assert.match(editor, /showPointGeometries: showPointGeometries\.checked/);
  assert.match(editor, /showLineGeometries: showLineGeometries\.checked/);
  assert.match(editor, /showPolygonGeometries: showPolygonGeometries\.checked/);
  assert.match(editor, /name="keywords"/);
  assert.match(editor, /name="yandexMetrikaId"/);
  assert.match(editor, /name="googleAnalyticsId"/);
  assert.match(editor, /name="footerHtml"/);
  assert.match(editor, /data-project-snippet="callout"/);
  assert.match(editor, /data-project-snippet="columns"/);
  assert.match(editor, /\/api\/admin\/project-settings/);
  assert.match(css, /\.project-theme-grid/);
  assert.match(css, /\.project-settings-tabs/);
  assert.match(css, /\.project-settings-page\[hidden\]/);
  assert.match(css, /\.project-history-speed-row/u);
  assert.match(css, /data-theme-preview/);
  assert.match(
    css,
    /@container admin-layout-block \(max-width: 64rem\)/u,
  );
  assert.match(
    css,
    /@container admin-layout-block \(max-width: 56rem\)/u,
  );
  assert.match(
    css,
    /@container admin-layout-block \(max-width: 44rem\)/u,
  );
  assert.doesNotMatch(
    css,
    /@media \(max-width:\s*(1050|900|700)px\)/u,
  );
  assert.doesNotMatch(
    shell,
    /adaptLegacyReportEditorNode|data-task-tab="report"|data-task-panel="report"/u,
  );
  assert.match(
    layoutSchema,
    /id:\s*'report'[\s\S]*hostId:[\s\S]*'report-config-editor-host'/u,
  );
  assert.match(
    shell,
    /setupAdminTabs\([\s\S]*definitions:[\s\S]*adminInterfaceTabs/u,
  );
  assert.match(
    layout,
    /tabsHost\.append\([\s\S]*tab/u,
  );
  assert.match(
    layout,
    /panelsHost\.append\([\s\S]*panel/u,
  );
  assert.match(
    layoutSchema,
    /id:\s*'project'[\s\S]*id:\s*'map'[\s\S]*id:\s*'report'[\s\S]*id:\s*'line-types'[\s\S]*id:\s*'point-types'/u,
  );

  assert.match(downloadEditor, /name="publicDownloadName"/);
  assert.match(downloadEditor, /публичных URL и для файлов на диске/);
  assert.match(downloadEditor, /`\/\$\{name\}\.geojson`/);
  assert.match(downloadEditor, /`\/\$\{name\}\.csv`/);
  assert.match(downloadEditor, /\/api\/admin\/project-settings\/public-download-name/);
  assert.match(downloadEditor, /#project-settings-editor-host/);
  assert.match(downloadEditor, /#project-settings-metadata/);
  assert.match(downloadEditor, /#project-settings-metadata-host/);
  assert.match(downloadEditor, /projectMessage\.before\(externalForm\)/);
  assert.match(downloadEditor, /metadataHost\.append\(section\)/);
  assert.match(downloadEditor, /section\.hidden = metadataPanel\.hidden/);
  assert.match(downloadEditor, /attributeFilter: \['hidden'\]/);
  assert.match(downloadEditor, /form="public-download-name-form"/);
  assert.match(downloadEditor, /Сохранить имя файлов/);
  assert.match(downloadCss, /\.project-download-name-form/);
});

test('public page derives metadata, theme stylesheet, analytics and download links from project settings', async () => {
  const [html, publicSite, middleware, page, metrics, contentCss, retroCss, classicCss, modernCss] = await Promise.all([
    source('index.html'),
    source('src/http/public-site.js'),
    source('src/http/app-middleware.js'),
    source('src/http/project-page.js'),
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
  assert.doesNotMatch(html, /bus-lanes\.jpeg/);
  assert.doesNotMatch(publicSite, /bus-lanes\.jpeg/);
  assert.match(html, /name="twitter:card" content="summary"/);
  assert.match(html, /data-theme="\{\{PROJECT_THEME_NAME\}\}"/);
  assert.match(html, /\{\{PROJECT_THEME_STYLESHEET\}\}/);
  assert.match(html, /name="keywords" content="\{\{PROJECT_KEYWORDS\}\}"/);
  assert.match(html, /\{\{PROJECT_METRICS_META\}\}/);
  assert.match(html, /\{\{PROJECT_METRICS_SCRIPT\}\}/);
  assert.match(html, /\{\{YANDEX_METRIKA_NOSCRIPT\}\}/);
  assert.match(html, /\{\{PROJECT_FOOTER_HTML\}\}/);
  assert.match(html, /\/css\/project-content\.css/);
  assert.match(publicSite, /projectManifest\(\s*settings,?\s*\)/s);
  assert.match(publicSite, /renderProjectPage\(\s*publicPageTemplate,\s*settings,?\s*\)/s);
  assert.match(middleware, /https:\/\/mc\.yandex\.ru/);
  assert.match(middleware, /https:\/\/mc\.yandex\.com/);
  assert.match(middleware, /wss:\/\/mc\.webvisor\.org/);
  assert.match(middleware, /YANDEX_METRIKA_FRAME_ANCESTORS/);
  assert.match(middleware, /frameAncestors/);
  assert.match(middleware, /https:\/\/\*\.googletagmanager\.com/);
  assert.match(page, /publicDownloadFiles\(settings\.publicDownloadName\)/);
  assert.match(page, /replaceAll\('\{\{PUBLIC_GEOJSON_URL\}\}', files\.geoJsonUrl\)/);
  assert.match(page, /replaceAll\('\{\{PUBLIC_CSV_URL\}\}', files\.csvUrl\)/);
  assert.match(metrics, /https:\/\/mc\.yandex\.ru\/metrika\/tag\.js/);
  assert.match(metrics, /https:\/\/www\.googletagmanager\.com\/gtag\/js/);
  assert.match(metrics, /metaContent\('yandex-metrika-id'\)/);
  assert.match(metrics, /metaContent\('google-analytics-id'\)/);
  assert.match(metrics, /webvisor: true/);
  assert.match(metrics, /triggerEvent: true/);
  assert.match(metrics, /window\.dtpstatMetrics = metricsState/);
  assert.match(metrics, /dtpstat:metrics-status/);
  assert.match(metrics, /script\.addEventListener\('error'/);
  assert.ok(html.indexOf('{{PROJECT_METRICS_SCRIPT}}') < html.indexOf('</head>'));
  assert.match(contentCss, /\.project-callout/);
  assert.match(contentCss, /\.project-columns/);
  assert.match(contentCss, /\.project-link-button/);
  assert.match(retroCss, /--selected:\s*#fff400/i);
  assert.match(classicCss, /--selected:\s*#ffdf75/i);
  assert.match(modernCss, /--selected:\s*#e5eee3/i);
});

test('public GeoJSON and CSV routes and disk files are fully derived from the configured base name', async () => {
  const [publicSite, service, atomicFiles] = await Promise.all([
    source('src/http/public-site.js'),
    source('src/application/public-downloads/service.js'),
    source('src/shared/files/atomic-snapshot.js'),
  ]);

  assert.match(
    publicSite,
    /app\.get\(\s*'\/:publicDownloadFile'/s,
  );
  assert.match(
    publicSite,
    /publicDownloadFiles\(\s*settings\s*\.publicDownloadName,?\s*\)/s,
  );
  assert.match(
    publicSite,
    /files\.csvFileName,[\s\S]*?'text\/csv; charset=utf-8'/,
  );
  assert.match(
    publicSite,
    /files\.geoJsonFileName,[\s\S]*?'application\/geo\+json; charset=utf-8'/,
  );
  assert.match(
    publicSite,
    /response\.sendFile\([\s\S]*?requestedFile,[\s\S]*?root:\s*publicDownloadDirectory/s,
  );
  assert.doesNotMatch(publicSite, /const PUBLIC_DOWNLOADS/);
  assert.doesNotMatch(publicSite, /bus-lanes\.csv/);
  assert.doesNotMatch(publicSite, /bus-lanes\.geojson/);

  assert.match(service, /files = publicDownloadFiles\(/);
  assert.match(service, /files\.geoJsonFileName/);
  assert.match(service, /files\.csvFileName/);
  assert.match(service, /replaceFiles\(\{/);
  assert.match(atomicFiles, /removeObsoleteFiles/);
  assert.match(atomicFiles, /await Promise\.all\(/);
  assert.match(atomicFiles, /await fs\.rename\(/);
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
  assert.match(publicApp, /showPointGeometries:\s*projectSettings\.showPointGeometries !== false/u);
  assert.match(publicApp, /showLineGeometries:\s*projectSettings\.showLineGeometries !== false/u);
  assert.match(publicApp, /showPolygonGeometries:\s*projectSettings\.showPolygonGeometries !== false/u);
  assert.match(mapController, /setGeometryTypeVisibility\(options = \{\}\)/u);
  assert.match(mapController, /!showPointGeometries/u);
  assert.match(mapController, /!showLineGeometries/u);
  assert.match(mapController, /!showPolygonGeometries/u);
});

test('public history makes the active moment explicit and collapsing always returns to now', async () => {
  const [
    html,
    publicApp,
    publicCss,
  ] = await Promise.all([
    source('index.html'),
    source('public/js/app.js'),
    source('public/css/app.css'),
  ]);

  assert.match(
    html,
    /id="geometry-timeline-toggle"[\s\S]*geometry-timeline-toggle-icon[\s\S]*id="geometry-timeline-toggle-state"[\s\S]*Сейчас/u,
  );
  assert.match(
    html,
    /id="geometry-timeline-date"[\s\S]*На карте: —/u,
  );
  assert.match(
    publicApp,
    /function applyTimelineDay\([\s\S]*'На карте: ' \+[\s\S]*mapController[\s\S]*\.setTimelineDate/u,
  );
  assert.match(
    publicApp,
    /timelineCollapse[\s\S]*stopTimelinePlayback\(\)[\s\S]*dateToDay\([\s\S]*localIsoDate\(\)[\s\S]*applyTimelineDay\([\s\S]*setTimelineCollapsed\([\s\S]*true/u,
  );
  assert.doesNotMatch(
    publicApp,
    /timelineToggleState|updateTimelineToggleState/u,
  );
  assert.match(
    publicCss,
    /\.geometry-timeline-toggle \{[\s\S]*grid-template-columns: 16px auto[\s\S]*border-radius: 21px/u,
  );
  assert.match(
    publicCss,
    /\.geometry-timeline-toggle-icon \{[\s\S]*place-items: center/u,
  );
  assert.match(
    publicCss,
    /\.geometry-timeline-toggle-icon::before \{[\s\S]*border-left: 11px solid #fff/u,
  );
});

test('retro table hides the low-zoom hint and uses zebra striping', async () => {
  const [publicApp, cityList, retroCss] = await Promise.all([
    source('public/js/app.js'),
    source('public/js/city-list.js'),
    source('public/css/themes/retro.css'),
  ]);

  assert.doesNotMatch(publicApp, /Выберите город или увеличьте карту для показа линий/);
  assert.match(publicApp, /setCityStatus\(''\)/);
  assert.match(cityList, /elements\.status\.hidden = !message/);
  assert.match(retroCss, /tbody tr:nth-child\(odd\)/);
  assert.match(retroCss, /tbody tr:nth-child\(even\)/);
  assert.match(retroCss, /tbody tr\.is-active/);
});
