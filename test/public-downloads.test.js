import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createAdminTaskManager } from '../src/data/admin-task-manager.js';
import {
  createPublicDownloadService,
  serializePublicCsv,
} from '../src/data/public-download-service.js';
import { createPublicDownloadRepository } from '../src/db/public-download-repository.js';

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

test('public CSV keeps the legacy default shape when no column config is supplied', () => {
  const csv = serializePublicCsv([
    {
      short_name: 'Город, "Тест"',
      lanes_length: 1234.5,
      population: 100000,
      lanes_per_1k: 12.345,
      minx: 30,
      miny: 50,
      maxx: 31,
      maxy: 51,
    },
  ]);

  assert.equal(
    csv,
    'short_name,lanes_length,population,lanes_per_1K,minx,miny,maxx,maxy\n' +
      '"Город, ""Тест""",1234.5,100000,12.345,30,50,31,51\n',
  );
});

test('public CSV applies configured metrics, order, scale and precision', () => {
  const csv = serializePublicCsv([
    {
      name: 'Тестоград',
      rank: 2,
      category: 'large',
      metrics: {
        separation_ratio: 0.6471,
        network_length_m: 132482.71,
        population: 512345,
      },
      minx: 30,
      miny: 50,
      maxx: 31,
      maxy: 51,
    },
  ], [
    { kind: 'rank', title: 'place' },
    { kind: 'city', title: 'city' },
    { kind: 'metric', metricKey: 'separation_ratio', title: 'separation_percent', scale: 100, decimals: 1 },
    { kind: 'metric', metricKey: 'network_length_m', title: 'network_km', scale: 0.001, decimals: 2 },
    { kind: 'category', title: 'category' },
  ]);

  assert.equal(
    csv,
    'place,city,separation_percent,network_km,category\n' +
      '2,Тестоград,64.7,132.48,large\n',
  );
});

test('public download service materializes configured file names and removes obsolete snapshots', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dtpstat-public-'));
  const repository = {
    async exportGeoJson() {
      return {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            id: 7,
            properties: { short_name: 'Тестоград', type: 'Двусторонние' },
            geometry: { type: 'LineString', coordinates: [[1, 2], [3, 4]] },
          },
        ],
      };
    },
    async exportCsvRows() {
      return [
        {
          name: 'Тестоград',
          rank: 1,
          category: 'large',
          metrics: { score: 5 },
          minx: 1,
          miny: 2,
          maxx: 3,
          maxy: 4,
        },
      ];
    },
    async exportCsvColumns() {
      return [
        { kind: 'city', title: 'city' },
        { kind: 'metric', metricKey: 'score', title: 'score', scale: 1, decimals: 1 },
      ];
    },
  };
  const projectSettingsRepository = {
    async get() { return { publicDownloadName: 'tram-lines' }; },
  };

  try {
    await fs.writeFile(path.join(directory, 'bus-lanes.geojson'), '{}\n', 'utf8');
    await fs.writeFile(path.join(directory, 'bus-lanes.csv'), 'old\n', 'utf8');

    const service = createPublicDownloadService({
      repository,
      projectSettingsRepository,
      directory,
    });
    const result = await service.refresh();
    const [geoJsonText, csvText, names] = await Promise.all([
      fs.readFile(service.geoJsonPath, 'utf8'),
      fs.readFile(service.csvPath, 'utf8'),
      fs.readdir(directory),
    ]);

    assert.equal(result.publicDownloadName, 'tram-lines');
    assert.equal(result.geoJsonFileName, 'tram-lines.geojson');
    assert.equal(result.csvFileName, 'tram-lines.csv');
    assert.equal(result.geoJsonUrl, '/tram-lines.geojson');
    assert.equal(result.csvUrl, '/tram-lines.csv');
    assert.equal(path.basename(service.geoJsonPath), 'tram-lines.geojson');
    assert.equal(path.basename(service.csvPath), 'tram-lines.csv');
    assert.equal(result.featureCount, 1);
    assert.equal(result.cityCount, 1);
    assert.equal(result.csvColumns, 2);
    assert.deepEqual(JSON.parse(geoJsonText), await repository.exportGeoJson());
    assert.equal(csvText, 'city,score\nТестоград,5.0\n');
    assert.deepEqual(names.sort(), ['tram-lines.csv', 'tram-lines.geojson']);
    assert.equal(names.some((name) => name.endsWith('.tmp')), false);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('public GeoJSON excludes service metadata while CSV reads materialized report values', async () => {
  const queries = [];
  const database = {
    async query(sql) {
      queries.push(sql);
      if (sql.includes("'FeatureCollection'")) {
        return { rows: [{ payload: { type: 'FeatureCollection', features: [] } }] };
      }
      if (sql.includes('csv_columns')) return { rows: [{ csvColumns: [] }] };
      return { rows: [] };
    },
  };
  const repository = createPublicDownloadRepository(database);

  await repository.exportGeoJson();
  await repository.exportCsvRows();
  await repository.exportCsvColumns();

  assert.doesNotMatch(queries[0], /_dtpstat|lineTypes|line_style|line_type\.color|line_type\.title/);
  assert.match(queries[0], /'type', line_type\.name/);
  assert.match(queries[0], /'population', population\.population/);
  assert.match(queries[1], /city_report_values AS report/);
  assert.match(queries[1], /report\.values/);
  assert.doesNotMatch(queries[1], /city\.lane_m_per_1000/);
  assert.match(queries[2], /FROM report_config/);
});

test('successful data tasks can materialize derived public data after commit', async () => {
  const refreshed = [];
  const manager = createAdminTaskManager({
    randomUUID: () => 'task-1',
    afterSuccessfulUpdate: async (update) => {
      refreshed.push(update.taskType);
      return { featureCount: 12, cityCount: 3 };
    },
  });

  manager.start({
    type: 'kml-update',
    endpoint: '/api/admin/update',
    recordsSuccessfulUpdate: true,
  }, async () => ({ importedGeometries: 12 }));
  await nextTurn();

  const completed = manager.get('task-1');
  assert.equal(completed.status, 'succeeded');
  assert.deepEqual(refreshed, ['kml-update']);
  assert.ok(completed.log.some((entry) =>
    entry.message === 'Производные публичные данные обновлены' &&
    entry.details.featureCount === 12));
});
