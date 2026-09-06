import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (relativePath) => fs.readFile(path.join(projectRoot, relativePath), 'utf8');

test('admin report builder is catalog-driven, four-tabbed and has no free-form expression editor', async () => {
  const [notices, editor, rangeUi, css, migration, reportConfig] = await Promise.all([
    source('admin/task-notices.js'),
    source('admin/report-config-editor.js'),
    source('admin/report-range-ui.js'),
    source('admin/report-config.css'),
    source('db/migrations/V014__configurable_city_reports.sql'),
    source('src/data/report-config.js'),
  ]);

  assert.match(notices, /report-config-editor\.js/);
  assert.match(notices, /report-range-ui\.js/);
  assert.match(editor, /dataset\.taskTab = 'report'/);
  assert.match(editor, /\/api\/admin\/report-config/);
  assert.match(editor, /data-report-view-tab="metrics"/);
  assert.match(editor, /data-report-view-tab="table"/);
  assert.match(editor, /data-report-view-tab="csv"/);
  assert.match(editor, /data-report-view-tab="rank"/);
  assert.match(editor, />Метрики</);
  assert.match(editor, />Публичная таблица</);
  assert.match(editor, />CSV</);
  assert.match(editor, />Рейтинг</);
  assert.match(editor, /state\.catalog\.fields/);
  assert.match(editor, /state\.catalog\.aggregates/);
  assert.match(editor, /state\.catalog\.operators/);
  assert.match(editor, /state\.catalog\.operandKinds/);
  assert.match(editor, /state\.catalog\.precedenceLevels/);
  assert.match(editor, /state\.catalog\.groupings/);
  assert.match(editor, /state\.catalog\.constants/);
  assert.match(editor, /state\.catalog\.scales/);
  assert.match(editor, /state\.catalog\.formatFontSizes/);
  assert.match(editor, /metricRpnTokens/);
  assert.match(editor, /metricDependsOn/);
  assert.match(editor, /Фактический порядок вычисления/);
  assert.match(editor, /ОПЗ/);
  assert.match(editor, /generatedMetricKey/);
  assert.match(editor, /Поднять метрику/);
  assert.match(editor, /Опустить метрику/);
  assert.match(editor, /Поднять операцию/);
  assert.match(editor, /Опустить операцию/);
  assert.match(editor, /Условное форматирование/);
  assert.match(editor, /input.*type = 'color'|color\.type = 'color'/s);
  assert.match(editor, /fontSizeStep/);
  assert.match(editor, /column\.formatRules/);
  assert.match(rangeUi, /От \(≥\)/);
  assert.match(rangeUi, /До \(<\)/);
  assert.match(rangeUi, /< 91; ≥ 91 и < 201; ≥ 201/);
  assert.match(css, /report-view-tabs/);
  assert.match(css, /report-format-rule-row/);
  assert.doesNotMatch(editor, /<textarea/i);

  assert.match(reportConfig, /key: 'city\.area_m2'/);
  assert.match(reportConfig, /key: 'metric', label: 'Другая метрика'/);
  assert.match(reportConfig, /key: 'median', label: 'Медиана'/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS BUSLANES\.REPORT_CONFIG/i);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS BUSLANES\.CITY_REPORT_VALUES/i);
});

test('public ranking headers, metric cells and conditional formats are generated from report configuration', async () => {
  const [html, app, list, css] = await Promise.all([
    source('index.html'),
    source('public/js/app.js'),
    source('public/js/city-list.js'),
    source('public/css/app.css'),
  ]);

  assert.match(html, /<thead><\/thead>/);
  assert.doesNotMatch(html, /data-sort="laneLengthMeters"/);
  assert.match(app, /loadReportConfig/);
  assert.match(app, /cityList\.setReportConfig\(reportConfig\)/);
  assert.match(list, /reportConfig\.tableColumns/);
  assert.match(list, /city\.metrics\?\.\[column\.metricKey\]/);
  assert.match(list, /applyConditionalFormatting/);
  assert.match(list, /valueMatchesRule/);
  assert.match(list, /value >= Number\(rule\.max\)/);
  assert.match(list, /column\.formatRules/);
  assert.match(list, /fontSizeStep/);
  assert.match(list, /textDecoration/);
  assert.match(list, /dataLabel|dataset\.label/);
  assert.match(css, /content: attr\(data-label\)/);
  assert.doesNotMatch(css, /content: "ВП /);
  assert.doesNotMatch(css, /content: "население /);
});

test('server refreshes report materialization before public snapshots', async () => {
  const server = await source('src/server.js');
  const reportPosition = server.indexOf("await refreshReportValues({reason: 'startup'})");
  const snapshotsPosition = server.indexOf("await refreshPublicDownloads({reason: 'startup'})");

  assert.ok(reportPosition >= 0);
  assert.ok(snapshotsPosition > reportPosition);
  assert.match(server, /await refreshReportValues\(details\);\s*return refreshPublicDownloads\(details\);/s);
});
