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
            publicDownloadName: 'bus-lanes',
            mapboxAccessTokenConfigured: Boolean(values[8]),
            largeCityPopulationThreshold: values[9],
            largeCityAreaKm2Threshold: values[10],
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
          largeCityPopulationThreshold: 400000,
          largeCityAreaKm2Threshold: null,
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
    mapboxAccessToken: 'pk.test-public-token-value',
    footerHtml: '<p class="project-muted">Описание</p>',
  });
  assert.equal(saved.projectName, 'Трамвайные пути России');
  assert.equal(saved.themePreset, 'modern');
  assert.equal(saved.showLinePopups, false);
  assert.equal(saved.publicDownloadName, 'bus-lanes');
  const firstUpdate = calls.find((call) => /UPDATE project_settings/i.test(call.text));
  assert.deepEqual(firstUpdate.values, [
    'Трамвайные пути России',
    ['трамвай'],
    '<p class="project-muted">Описание</p>',
    '12345678',
    'G-AB12CD34EF',
    'modern',
    true,
    false,
    'pk.test-public-token-value',
    400000,
    null,
  ]);
  const firstRecalculationIndex = calls.findIndex((call) =>
    /WITH\s+geometry_statistics\s+AS/i.test(call.text) &&
    /UPDATE\s+cities\s+AS\s+city/i.test(call.text),
  );
  const firstUpdateIndex = calls.findIndex((call) =>
    /UPDATE\s+project_settings/i.test(call.text),
  );
  assert.ok(firstUpdateIndex >= 0);
  assert.ok(firstRecalculationIndex > firstUpdateIndex);
  assert.match(
    calls[firstRecalculationIndex].text,
    /large_city_population_threshold\s+AS\s+population_threshold/i,
  );
  assert.match(
    calls[firstRecalculationIndex].text,
    /large_city_area_km2_threshold\s+AS\s+area_threshold_km2/i,
  );

  await repository.save({
    projectName: 'Трамвайные пути России',
    keywords: ['трамвай'],
    yandexMetrikaId: null,
    googleAnalyticsId: null,
    themePreset: 'classic',
    showLineLabels: false,
    footerHtml: '<p>Описание</p>',
  });
  const updates = calls.filter((call) => /UPDATE project_settings/i.test(call.text));
  assert.equal(updates[1].values[7], null);
  assert.equal(updates[1].values[8], null);
  assert.equal(updates[1].values[9], 400000);
  assert.equal(updates[1].values[10], null);
  assert.match(updates[1].text, /show_line_popups = COALESCE\(\$8::boolean, show_line_popups\)/i);
  assert.doesNotMatch(updates[1].text, /public_download_name\s*=/i);

  await repository.save({
    projectName: 'Трамвайные пути России',
    keywords: ['трамвай'],
    yandexMetrikaId: null,
    googleAnalyticsId: null,
    themePreset: 'classic',
    showLineLabels: false,
    showLinePopups: true,
    largeCityPopulationThreshold: 500000,
    largeCityAreaKm2Threshold: 250,
    footerHtml: '<p>Описание</p>',
  });
  const thresholdUpdates = calls.filter((call) =>
    /UPDATE\s+project_settings/i.test(call.text));
  assert.equal(thresholdUpdates.at(-1).values[9], 500000);
  assert.equal(thresholdUpdates.at(-1).values[10], 250);
  const recalculations = calls.filter((call) =>
    /WITH\s+geometry_statistics\s+AS/i.test(call.text) &&
    /UPDATE\s+cities\s+AS\s+city/i.test(call.text),
  );
  assert.equal(recalculations.length, 3);

  await assert.rejects(
    async () => repository.save({
      projectName: 'Трамвайные пути России',
      keywords: ['трамвай'],
      yandexMetrikaId: null,
      googleAnalyticsId: null,
      themePreset: 'classic',
      showLineLabels: false,
      publicDownloadName: 'tram-lines',
      footerHtml: '<p>Описание</p>',
    }),
    /unsupported properties/i,
  );

  const renamed = await repository.savePublicDownloadName('  Трамвайные   линии  ');
  assert.equal(renamed.publicDownloadName, 'Трамвайные линии');
  const publicDownloadUpdate = calls.find((call) =>
    /SET\s+public_download_name = \$1/i.test(call.text));
  assert.deepEqual(publicDownloadUpdate.values, ['Трамвайные линии']);
});


test('project settings save commits thresholds and city classification atomically', async () => {
  const calls = [];
  let released = false;
  const client = {
    async query(text, values) {
      const normalized = text.trim();
      calls.push({ text: normalized, values });
      if (/UPDATE project_settings/i.test(normalized)) {
        return {
          rows: [{
            projectName: values[0],
            keywords: values[1],
            footerHtml: values[2],
            yandexMetrikaId: values[3],
            googleAnalyticsId: values[4],
            themePreset: values[5] ?? 'classic',
            showLineLabels: values[6],
            showLinePopups: values[7] ?? true,
            publicDownloadName: 'bus-lanes',
            mapboxAccessTokenConfigured: false,
            largeCityPopulationThreshold: values[9],
            largeCityAreaKm2Threshold: values[10],
            updatedAt: '2026-09-22T18:00:00.000Z',
          }],
        };
      }
      return { rows: [] };
    },
    release() {
      released = true;
    },
  };
  const database = {
    databaseSchema: 'buslanes',
    async connect() {
      return client;
    },
    async query() {
      throw new Error('pool.query must not be used during transactional save');
    },
  };
  const repository = createProjectSettingsRepository(database);

  const saved = await repository.save({
    projectName: 'Выделенные полосы в России',
    keywords: ['транспорт'],
    footerHtml: '<p>Описание</p>',
    yandexMetrikaId: null,
    googleAnalyticsId: null,
    themePreset: 'classic',
    showLineLabels: false,
    showLinePopups: true,
    largeCityPopulationThreshold: 550000,
    largeCityAreaKm2Threshold: 300,
  });

  assert.equal(saved.largeCityPopulationThreshold, 550000);
  assert.equal(saved.largeCityAreaKm2Threshold, 300);
  assert.equal(calls[0].text, 'BEGIN');
  assert.match(calls[1].text, /pg_advisory_xact_lock/i);
  const updateIndex = calls.findIndex((call) =>
    /UPDATE project_settings/i.test(call.text));
  const recalcIndex = calls.findIndex((call) =>
    /WITH\s+geometry_statistics\s+AS/i.test(call.text) &&
    /UPDATE\s+cities\s+AS\s+city/i.test(call.text),
  );
  const commitIndex = calls.findIndex((call) => call.text === 'COMMIT');
  assert.ok(updateIndex > 0);
  assert.ok(recalcIndex > updateIndex);
  assert.ok(commitIndex > recalcIndex);
  assert.equal(released, true);
});
