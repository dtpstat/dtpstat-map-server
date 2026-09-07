import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectSettingsRepository } from '../src/db/project-settings-repository.js';

test('project settings repository reads and updates the singleton row', async () => {
  const calls = [];
  const database = {
    async query(text, values) {
      calls.push({ text, values });
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
            mapboxAccessTokenConfigured: Boolean(values[7]),
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
  assert.match(calls[0].text, /theme_preset AS "themePreset"/i);
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
    mapboxAccessToken: 'pk.test-public-token-value',
    footerHtml: '<p class="project-muted">Описание</p>',
  });
  assert.equal(saved.projectName, 'Трамвайные пути России');
  assert.equal(saved.themePreset, 'modern');
  assert.deepEqual(calls[1].values, [
    'Трамвайные пути России',
    ['трамвай'],
    '<p class="project-muted">Описание</p>',
    '12345678',
    'G-AB12CD34EF',
    'modern',
    true,
    'pk.test-public-token-value',
  ]);
});