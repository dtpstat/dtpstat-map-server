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

test('public CSV uses stable columns and escapes values', () => {
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

test('public download service materializes GeoJSON and CSV as files', async () => {
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
          short_name: 'Тестоград',
          lanes_length: 1000,
          population: 200000,
          lanes_per_1k: 5,
          minx: 1,
          miny: 2,
          maxx: 3,
          maxy: 4,
        },
      ];
    },
  };

  try {
    const service = createPublicDownloadService({ repository, directory });
    const result = await service.refresh();
    const [geoJsonText, csvText] = await Promise.all([
      fs.readFile(service.geoJsonPath, 'utf8'),
      fs.readFile(service.csvPath, 'utf8'),
    ]);

    assert.equal(result.featureCount, 1);
    assert.equal(result.cityCount, 1);
    assert.deepEqual(JSON.parse(geoJsonText), await repository.exportGeoJson());
    assert.match(csvText, /^short_name,lanes_length,population,lanes_per_1K,/);
    assert.match(csvText, /Тестоград,1000,200000,5,1,2,3,4/);
    assert.equal(
      (await fs.readdir(directory)).some((name) => name.endsWith('.tmp')),
      false,
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('public GeoJSON query excludes portable dictionaries and style metadata', async () => {
  const queries = [];
  const database = {
    async query(sql) {
      queries.push(sql);
      if (sql.includes("'FeatureCollection'")) {
        return { rows: [{ payload: { type: 'FeatureCollection', features: [] } }] };
      }
      return { rows: [] };
    },
  };
  const repository = createPublicDownloadRepository(database);

  await repository.exportGeoJson();
  await repository.exportCsvRows();

  assert.doesNotMatch(queries[0], /_dtpstat|lineTypes|line_style|line_type\.color|line_type\.title/);
  assert.match(queries[0], /'type', line_type\.name/);
  assert.match(queries[0], /'population', population\.population/);
  assert.match(queries[1], /city\.lane_m_per_1000/);
});

test('successful data tasks can materialize public downloads after commit', async () => {
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
