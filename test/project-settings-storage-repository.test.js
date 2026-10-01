import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createProjectSettingsStorageRepository,
} from '../src/db/project-settings-storage-repository.js';

function createQueryable() {
  const queries = [];
  return {
    queries,
    async query(text, values = []) {
      const normalized = text.trim();
      queries.push({ text: normalized, values });

      if (normalized.startsWith('SELECT') &&
          normalized.includes('project_name AS "projectName"')) {
        return {
          rows: [{
            projectName: 'Test',
            cityMarkerIconHeight: 32,
          }],
          rowCount: 1,
        };
      }
      if (normalized.includes('FROM geometry_history_speeds')) {
        return {
          rows: [{
            id: 1,
            name: '1x',
            stepUnit: 'month',
            intervalSeconds: 1,
            sortOrder: 10,
            isActive: true,
            isDefault: true,
          }],
          rowCount: 1,
        };
      }
      if (normalized.startsWith('UPDATE project_settings') &&
          normalized.includes('project_name = $1')) {
        return {
          rows: [{
            projectName: values[0],
            cityMarkerIconHeight: 32,
          }],
          rowCount: 1,
        };
      }
      if (normalized.includes('public_download_name = $1')) {
        return {
          rows: [{
            publicDownloadName: values[0],
          }],
          rowCount: 1,
        };
      }
      return { rows: [{}], rowCount: 1 };
    },
  };
}

test('project settings storage owns singleton read and update SQL', async () => {
  const storage = createProjectSettingsStorageRepository();
  const database = createQueryable();

  const current = await storage.get(database);
  const saved = await storage.updateSettings(database, {
    plan: {
      projectName: 'Changed',
      keywords: ['map'],
      footerHtml: '<p>Changed</p>',
      yandexMetrikaId: null,
      googleAnalyticsId: null,
    },
    themePreset: 'modern',
    showLineLabels: true,
    showLinePopups: false,
    showGeometryTimeline: true,
    historyStartDate: '2000-01-01',
    historySpeeds: null,
    showPointGeometries: true,
    showLineGeometries: false,
    showPolygonGeometries: true,
    mapboxAccessToken: null,
    largeCityPopulationThreshold: 500000,
    largeCityAreaKm2Threshold: 250,
  });

  assert.equal(current.projectName, 'Test');
  assert.equal(saved.projectName, 'Changed');
  assert.match(
    database.queries[0].text,
    /city_marker_icon_height::integer AS "cityMarkerIconHeight"/u,
  );
  assert.match(
    database.queries[2].text,
    /^UPDATE project_settings/u,
  );
  assert.deepEqual(
    database.queries[2].values.slice(-7),
    [500000, 250, true, true, false, true, '2000-01-01'],
  );
  assert.match(
    database.queries[0].text,
    /show_geometry_timeline AS "showGeometryTimeline"/u,
  );
  assert.match(
    database.queries[2].text,
    /show_geometry_timeline = \$12::boolean/u,
  );
  assert.match(
    database.queries[0].text,
    /show_point_geometries AS "showPointGeometries"/u,
  );
  assert.match(
    database.queries[0].text,
    /show_line_geometries AS "showLineGeometries"/u,
  );
  assert.match(
    database.queries[0].text,
    /show_polygon_geometries AS "showPolygonGeometries"/u,
  );
  assert.match(database.queries[2].text, /show_point_geometries = \$13::boolean/u);
  assert.match(database.queries[2].text, /show_line_geometries = \$14::boolean/u);
  assert.match(database.queries[2].text, /show_polygon_geometries = \$15::boolean/u);
  assert.match(database.queries[0].text, /history_start_date::text AS "historyStartDate"/u);
  assert.match(database.queries[2].text, /history_start_date = \$16::date/u);
  assert.match(database.queries[1].text, /FROM geometry_history_speeds/u);
  assert.match(database.queries[3].text, /FROM geometry_history_speeds/u);
  assert.equal(current.historySpeeds[0].name, '1x');
  assert.equal(saved.historySpeeds[0].stepUnit, 'month');
});

test('project settings storage keeps public download name in dedicated update', async () => {
  const storage = createProjectSettingsStorageRepository();
  const database = createQueryable();

  const result = await storage.updatePublicDownloadName(
    database,
    'tram-lines',
  );

  assert.equal(result.publicDownloadName, 'tram-lines');
  assert.match(
    database.queries[0].text,
    /public_download_name = \$1/u,
  );
  assert.deepEqual(database.queries[0].values, ['tram-lines']);
});
