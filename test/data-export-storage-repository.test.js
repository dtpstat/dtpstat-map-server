import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDataExportStorageRepository,
} from '../src/db/data-export-storage-repository.js';

test('portable export storage owns non-streaming city and line snapshot SQL', async () => {
  const queries = [];
  const queryable = {
    async query(text) {
      const normalized = text.trim();
      queries.push(normalized);
      if (normalized.includes("'dtpstat-buslines-cities'")) {
        return { rows: [{ payload: { type: 'FeatureCollection', features: [] } }] };
      }
      if (normalized.includes("'dtpstat-buslines-lines'")) {
        return { rows: [{ payload: { type: 'FeatureCollection', lineTypes: [], features: [] } }] };
      }
      throw new Error(`Unexpected SQL: ${normalized}`);
    },
  };
  const storage = createDataExportStorageRepository();

  const cities = await storage.exportCityBoundaries(queryable);
  const lines = await storage.exportLines(queryable);

  assert.equal(cities.type, 'FeatureCollection');
  assert.equal(lines.type, 'FeatureCollection');
  assert.match(queries[0], /ST_AsGeoJSON\(boundary\.geom\)/u);
  assert.match(queries[1], /businessTypeCode/u);
  assert.match(queries[1], /boundary\.is_active/u);
});

test('portable export storage owns population ancestry query', async () => {
  const queries = [];
  const queryable = {
    async query(text) {
      queries.push(text.trim());
      return { rows: [{ regionId: 1, cityId: 2 }] };
    },
  };
  const storage = createDataExportStorageRepository();

  const result = await storage.populationRows(queryable);

  assert.equal(result.rows[0].regionId, 1);
  assert.match(queries[0], /^WITH RECURSIVE ancestry AS/u);
  assert.match(queries[0], /region\.admin_level = 4/u);
  assert.match(queries[0], /city\.osm_id::text AS "cityOsmId"/u);
});

test('portable export storage streams cursor rows in bounded fetches and closes cursor', async () => {
  const calls = [];
  let fetches = 0;
  const client = {
    async query(text) {
      const normalized = text.trim();
      calls.push(normalized);
      if (normalized.startsWith('DECLARE portable_line_export')) {
        return { rows: [] };
      }
      if (normalized === 'FETCH FORWARD 2 FROM portable_line_export') {
        fetches += 1;
        return fetches === 1
          ? { rows: [{ item: '{"type":"Feature"}' }] }
          : { rows: [] };
      }
      if (normalized === 'CLOSE portable_line_export') {
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL: ${normalized}`);
    },
  };
  const storage = createDataExportStorageRepository();

  const items = [];
  for await (const item of storage.streamLineItems(client, 2)) {
    items.push(item);
  }

  assert.deepEqual(items, ['{"type":"Feature"}']);
  assert.match(
    calls[0],
    /^DECLARE portable_line_export NO SCROLL CURSOR FOR/u,
  );
  assert.match(calls[0], /FROM city_geometries AS geometry/u);
  assert.equal(calls.at(-1), 'CLOSE portable_line_export');
});
