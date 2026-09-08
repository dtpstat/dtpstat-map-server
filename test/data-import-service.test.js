import assert from 'node:assert/strict';
import test from 'node:test';
import { createDataImportService } from '../src/db/data-import-service.js';

const upload = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {
        short_name: 'Тестоград',
        name: 'Тестоград',
        lanes: 2,
      },
      geometry: {
        type: 'LineString',
        coordinates: [[30, 60], [30.1, 60.1]],
      },
    },
  ],
};

const versionedUpload = {
  type: 'FeatureCollection',
  schemaVersion: 3,
  lineTypes: [
    {
      code: 0,
      name: 'default',
      title: 'Основные',
      color: '#045b69',
      style: 'solid',
      width: 4,
    },
    {
      code: 17,
      name: 'Трамвай',
      title: 'Трамвайные линии',
      color: '#cc4400',
      style: 'dashed',
      width: 6,
    },
  ],
  features: [
    {
      ...upload.features[0],
      properties: {
        ...upload.features[0].properties,
        _dtpstat: { businessTypeCode: 17 },
      },
    },
  ],
};

function createFakePool({ failOn } = {}) {
  const queries = [];
  let released = false;
  const client = {
    async query(text) {
      const normalized = text.trim();
      queries.push(normalized);
      if (failOn && normalized.includes(failOn)) {
        throw new Error('database failure');
      }
      if (normalized.includes('INSERT INTO city_geometries')) {
        return { rows: [], rowCount: 1 };
      }
      if (normalized.startsWith('WITH geometry_statistics AS')) {
        return { rows: [{ id: 1 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {
      released = true;
    },
  };

  return {
    queries,
    get released() { return released; },
    async connect() { return client; },
  };
}

test('legacy data import replaces geometries without replacing line type dictionary', async () => {
  const pool = createFakePool();
  const service = createDataImportService(pool);

  const result = await service.replaceFromGeoJson(upload);

  assert.equal(result.cities, 1);
  assert.equal(result.geometries, 1);
  assert.deepEqual(result.lineTypes, ['default']);
  assert.equal(pool.queries[0], 'BEGIN');
  assert.equal(pool.queries.some((query) => query.startsWith('DELETE FROM cities')), false);
  assert.equal(
    pool.queries.some((query) => query.startsWith('DELETE FROM line_types AS line_type')),
    false,
  );
  assert.equal(pool.queries.some((query) => /\bbounds\b/i.test(query)), false);
  assert.match(pool.queries.at(-2), /^WITH geometry_statistics AS/);
  assert.equal(pool.queries.at(-1), 'COMMIT');
  assert.equal(pool.released, true);
});

test('versioned data import applies dictionary by imported NAME before inserting geometries', async () => {
  const pool = createFakePool();
  const service = createDataImportService(pool);

  const result = await service.replaceFromGeoJson(versionedUpload);

  assert.deepEqual(result.lineTypes, ['Трамвай']);
  assert.ok(pool.queries.some((query) => query.includes('UPDATE line_types AS line_type')));
  assert.ok(pool.queries.some((query) => query.includes('INSERT INTO line_types (name, title')));
  const geometryDelete = pool.queries.indexOf('DELETE FROM city_geometries');
  const typeDelete = pool.queries.findIndex((query) =>
    query.includes('WITH payload AS') && query.includes('DELETE FROM line_types AS line_type'));
  const typeUpdate = pool.queries.findIndex((query) => query.includes('UPDATE line_types AS line_type'));
  const geometryInsert = pool.queries.findIndex((query) => query.includes('INSERT INTO city_geometries'));
  assert.ok(geometryDelete >= 0);
  assert.ok(typeDelete > geometryDelete);
  assert.ok(typeUpdate > typeDelete);
  assert.ok(geometryInsert > typeUpdate);
  assert.equal(pool.queries.at(-1), 'COMMIT');
});

test('data import rolls back and releases its connection after a database error', async () => {
  const pool = createFakePool({ failOn: 'INSERT INTO city_geometries' });
  const service = createDataImportService(pool);

  await assert.rejects(service.replaceFromGeoJson(upload), /database failure/);

  assert.equal(pool.queries.at(-1), 'ROLLBACK');
  assert.equal(pool.released, true);
  assert.doesNotMatch(pool.queries.join('\n'), /COMMIT/);
});
