import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectSettingsRepository } from '../src/db/project-settings-repository.js';

test('project settings repository reads and updates the singleton row', async () => {
  const calls = [];
  const database = {
    async query(text, values) {
      calls.push({ text, values });
      if (/SET\s+public_download_name = \$1/i.test(text)) {
        return {
          rows: [{
            publicDownloadName: values[0],
            updatedAt: '2026-09-05T14:00:00.000Z',
          }],
        };
      }
      if (/UPDATE project_settings/i.test(text)) {
        return {
          rows: [{
            projectName: values[0],
            keywords: values[1],
            footerHtml: values[2],
            yandexMetrikaId: values[3],
            googleAnalyticsId: values[4],
            themePreset: values[5],
            showLineLabels: values[6],
            showLinePopups: values[7] ?? true,
            publicDownloadName: values[8] ?? 'bus-lanes',
            mapboxAccessTokenConfigured: Boolean(values[9]),
            updatedAt: '2026-09-05T13:00:00.000Z',
          }],
        };
      }
      return {
        rows: [{
          projectName: 'Выделенные полосы в России',
          keywords: ['транспорт'],
          footerHtml: '<h2>О проекте</h2>',
          yandexMetrikaId: null,
          googleAnalyticsId: null,
          themePreset: 'classic',
          showLineLabels: false,
          showLinePopups: true,
          publicDownloadName: 'bus-lanes',
          mapboxAccessTokenConfigured: false,
          updatedAt: '2026-09-05T12:00:00.000Z',
        }],
      };
    },
  };
  const repository = createProjectSettingsRepository(database);

  const initial = await repository.get();
  assert.equal(initial.projectName, 'Выделенные полосы в России');
  assert.equal(initial.themePreset, 'classic');
  assert.equal(initial.showLinePopups, true);
  assert.equal(initial.publicDownloadName, 'bus-lanes');
  assert.match(calls[0].text, /theme_preset AS "themePreset"/i);
  assert.match(calls[0].text, /show_line_popups AS "showLinePopups"/i);
  assert.match(calls[0].text, /public_download_name AS "publicDownloadName"/i);
  assert.match(calls[0].text, /yandex_metrika_id AS "yandexMetrikaId"/i);
  assert.match(calls[0].text, /google_analytics_id AS "googleAnalyticsId"/i);
  assert.match(calls[0].text, /WHERE id = 1/i);

  const saved = await repository.save({
    projectName: 'Трамвайные пути России',
    keywords: ['трамвай'],
    yandexMetrikaId: '12345678',
    googleAnalyticsId: 'g-ab12cd34ef',
    themePreset: 'modern',
    showLineLabels: true,
    showLinePopups: false,
    publicDownloadName: 'tram-lines',
    mapboxAccessToken: 'pk.test-public-token-value',
    footerHtml: '<p class="project-muted">Описание</p>',
  });
  assert.equal(saved.projectName, 'Трамвайные пути России');
  assert.equal(saved.themePreset, 'modern');
  assert.equal(saved.showLinePopups, false);
  assert.equal(saved.publicDownloadName, 'tram-lines');
  assert.deepEqual(calls[1].values, [
    'Трамвайные пути России',
    ['трамвай'],
    '<p class="project-muted">Описание</p>',
    '12345678',
    'G-AB12CD34EF',
    'modern',
    true,
    false,
    'tram-lines',
    'pk.test-public-token-value',
  ]);

  await repository.save({
    projectName: 'Трамвайные пути России',
    keywords: ['трамвай'],
    yandexMetrikaId: null,
    googleAnalyticsId: null,
    themePreset: 'classic',
    showLineLabels: false,
    footerHtml: '<p>Описание</p>',
  });
  assert.equal(calls[2].values[7], null);
  assert.equal(calls[2].values[8], null);
  assert.match(calls[2].text, /show_line_popups = COALESCE\(\$8::boolean, show_line_popups\)/i);
  assert.match(calls[2].text, /public_download_name = COALESCE\(\$9::text, public_download_name\)/i);

  const renamed = await repository.savePublicDownloadName('  Трамвайные   линии  ');
  assert.equal(renamed.publicDownloadName, 'Трамвайные линии');
  assert.deepEqual(calls[3].values, ['Трамвайные линии']);
});