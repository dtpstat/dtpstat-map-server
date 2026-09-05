import assert from 'node:assert/strict';
import test from 'node:test';
import { createKmlUpdateService } from '../src/db/kml-update-service.js';

const source = {
  URL: 'https://www.google.com/maps/d/viewer?mid=test',
  fetchURL: 'https://www.google.com/maps/d/kml?mid=test&forcekml=1',
  mapId: 'test',
  layers: [{ name: 'Слой', multiple: 2, type: 'default' }],
};

const config = {
  sources: [source],
  allowedHosts: new Set(['www.google.com']),
  maxSources: 10,
  dryRun: false,
  timeoutMs: 30000,
  maxFileBytes: 1000000,
  maxTotalBytes: 2000000,
  cityBufferMeters: 0,
  cityBufferMaxMeters: 5000,
  unmatchedPolicy: 'skip',
  ambiguousPolicy: 'best-overlap',
};

const features = [
  {
    multiple: 2,
    businessTypeName: 'default',
    fingerprint: 'first',
    properties: {
      sourceURL: source.URL,
      layer: 'Слой',
      placemarkName: 'Первая',
    },
    geometry: { type: 'LineString', coordinates: [[1, 1], [2, 2]] },
  },
  {
    multiple: 1,
    businessTypeName: 'default',
    fingerprint: 'second',
    properties: {
      sourceURL: source.URL,
      layer: 'Слой',
      placemarkName: 'Вторая',
    },
    geometry: { type: 'LineString', coordinates: [[3, 3], [4, 4]] },
  },
  {
    multiple: 1,
    businessTypeName: 'default',
    fingerprint: 'unmatched',
    properties: {
      sourceURL: source.URL,
      layer: 'Слой',
      placemarkName: 'Без города',
    },
    geometry: { type: 'LineString', coordinates: [[5, 5], [6, 6]] },
  },
];

const defaultType = {
  requestedName: 'default',
  id: 1,
  code: 0,
  name: 'default',
  title: 'Выделенные полосы',
  color: '#045b69',
  style: 'solid',
  width: 4,
};

function createPool({ createdLineTypes = [], typeRows = [defaultType] } = {}) {
  const queries = [];
  let released = false;
  let connections = 0;
  const client = {
    async query(text) {
      const normalized = text.trim();
      queries.push(normalized);
      if (
        normalized.startsWith('WITH requested AS') &&
        normalized.includes('INSERT INTO line_types (name, title)')
      ) {
        return { rows: createdLineTypes, rowCount: createdLineTypes.length };
      }
      if (
        normalized.startsWith('WITH requested AS') &&
        normalized.includes('requested.name AS "requestedName"')
      ) {
        return { rows: typeRows, rowCount: typeRows.length };
      }
      if (normalized.startsWith('SELECT EXISTS')) {
        return { rows: [{ ready: true }], rowCount: 1 };
      }
      if (normalized.includes('LEFT JOIN LATERAL')) {
        return {
          rows: [
            { inputIndex: 0, boundaryId: '11', cityId: '1', cityName: 'Первый', candidateCount: 1 },
            { inputIndex: 1, boundaryId: '12', cityId: null, cityName: null, candidateCount: 2 },
            { inputIndex: 2, boundaryId: null, cityId: null, cityName: null, candidateCount: 0 },
          ],
        };
      }
      if (
        normalized.startsWith('WITH payload_rows AS') &&
        normalized.includes('INSERT INTO city_geometries')
      ) {
        return { rows: [], rowCount: 2 };
      }
      if (normalized.startsWith('WITH geometry_statistics AS')) {
        return { rows: [{ id: 1 }, { id: 2 }], rowCount: 2 };
      }
      if (normalized.startsWith('INSERT INTO geometry_update_runs')) {
        return {
          rows: [{ id: 7, createdAt: '2026-08-31T12:00:00.000Z' }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    },
    release() { released = true; },
  };
  return {
    queries,
    get released() { return released; },
    get connections() { return connections; },
    async connect() {
      connections += 1;
      return client;
    },
  };
}

const dependencies = {
  async download() {
    return { xml: '<kml/>', bytes: 6, finalURL: source.fetchURL };
  },
  parse() {
    return {
      documentName: 'Тест',
      features,
      selectedPlacemarks: 3,
      ignoredNonLines: 0,
    };
  },
};

test('KML update resolves imported NAME to local numeric type and atomically replaces geometries', async () => {
  const pool = createPool();
  const service = createKmlUpdateService(pool, config, dependencies);

  const result = await service.update(undefined, {});

  assert.equal(result.importedGeometries, 2);
  assert.equal(result.skippedWithoutCity, 1);
  assert.equal(result.resolvedAmbiguous, 1);
  assert.equal(result.lineTypes[0].code, 0);
  assert.equal(result.lineTypes[0].name, 'default');
  assert.deepEqual(result.createdLineTypes, []);
  assert.equal(result.updateRunId, 7);
  assert.equal(pool.queries.some((query) => query === 'DELETE FROM city_geometries'), true);
  assert.equal(
    pool.queries.some((query) => query.includes('"lineTypeId" bigint')),
    true,
  );
  assert.equal(pool.queries.at(-1), 'COMMIT');
  assert.equal(pool.released, true);
});

test('KML automatically creates missing NAME and database supplies numeric CODE', async () => {
  const typedFeatures = features.map((feature, index) => ({
    ...feature,
    businessTypeName: index === 1 ? 'Односторонние' : 'Двусторонние',
  }));
  const createdLineTypes = [
    {
      id: 2,
      code: 1,
      name: 'Двусторонние',
      title: 'Двусторонние',
      color: '#045b69',
      style: 'solid',
      width: 4,
    },
    {
      id: 3,
      code: 2,
      name: 'Односторонние',
      title: 'Односторонние',
      color: '#045b69',
      style: 'solid',
      width: 4,
    },
  ];
  const typeRows = createdLineTypes.map((lineType) => ({
    requestedName: lineType.name,
    ...lineType,
  }));
  const pool = createPool({ createdLineTypes, typeRows });
  const service = createKmlUpdateService(pool, config, {
    ...dependencies,
    parse() {
      return {
        documentName: 'Тест',
        features: typedFeatures,
        selectedPlacemarks: 3,
        ignoredNonLines: 0,
      };
    },
  });

  const result = await service.update(undefined, {});

  assert.deepEqual(result.createdLineTypes, createdLineTypes);
  assert.deepEqual(result.lineTypes.map((lineType) => lineType.code), [1, 2]);
  assert.equal(
    pool.queries.some((query) => query.includes('INSERT INTO line_types (name, title)')),
    true,
  );
  assert.equal(
    pool.queries.some((query) => query.includes('INSERT INTO line_types (code')),
    false,
  );
  assert.equal(pool.queries.at(-1), 'COMMIT');
});

test('KML matches imported NAME ignoring case and outer spaces without creating another type', async () => {
  const typedFeatures = features.map((feature) => ({
    ...feature,
    businessTypeName: '  Двусторонние  ',
  }));
  const existing = {
    requestedName: 'Двусторонние',
    id: 5,
    code: 9,
    name: 'двусторонние',
    title: 'Две стороны',
    color: '#123456',
    style: 'solid',
    width: 4,
  };
  const pool = createPool({ typeRows: [existing] });
  const service = createKmlUpdateService(pool, config, {
    ...dependencies,
    parse() {
      return {
        documentName: 'Тест',
        features: typedFeatures,
        selectedPlacemarks: 3,
        ignoredNonLines: 0,
      };
    },
  });

  const result = await service.update(undefined, {});
  assert.deepEqual(result.createdLineTypes, []);
  assert.equal(result.lineTypes[0].code, 9);
  assert.equal(result.lineTypes[0].title, 'Две стороны');
});

test('KML dry run performs matching and rolls the transaction back', async () => {
  const pool = createPool();
  const service = createKmlUpdateService(pool, config, dependencies);

  const result = await service.update(undefined, { dryRun: 'true' });

  assert.equal(result.dryRun, true);
  assert.equal(result.importedGeometries, 2);
  assert.equal(pool.queries.some((query) => query === 'DELETE FROM city_geometries'), false);
  assert.equal(pool.queries.at(-1), 'ROLLBACK');
});

test('KML download failure happens before a database connection is opened', async () => {
  const pool = createPool();
  const service = createKmlUpdateService(pool, config, {
    async download() { throw new Error('network failed'); },
  });

  await assert.rejects(service.update(undefined, {}), /network failed/);
  assert.equal(pool.connections, 0);
});
