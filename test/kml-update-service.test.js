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
    lineType: 'default',
    fingerprint: 'first',
    properties: {
      sourceURL: source.URL,
      layer: 'Слой',
      placemarkName: 'Первая',
    },
    geometry: {
      type: 'LineString',
      coordinates: [[1, 1], [2, 2]],
    },
  },
  {
    multiple: 1,
    lineType: 'default',
    fingerprint: 'second',
    properties: {
      sourceURL: source.URL,
      layer: 'Слой',
      placemarkName: 'Вторая',
    },
    geometry: {
      type: 'LineString',
      coordinates: [[3, 3], [4, 4]],
    },
  },
  {
    multiple: 1,
    lineType: 'default',
    fingerprint: 'unmatched',
    properties: {
      sourceURL: source.URL,
      layer: 'Слой',
      placemarkName: 'Без города',
    },
    geometry: {
      type: 'LineString',
      coordinates: [[5, 5], [6, 6]],
    },
  },
];

function createPool({ nameConflicts = [], createdLineTypes = [] } = {}) {
  const queries = [];
  let released = false;
  let connections = 0;
  const client = {
    async query(text) {
      const normalized = text.trim();
      queries.push(normalized);
      if (
        normalized.startsWith('WITH requested AS') &&
        normalized.includes('existing.name AS "existingName"')
      ) {
        return { rows: nameConflicts, rowCount: nameConflicts.length };
      }
      if (
        normalized.startsWith('WITH requested AS') &&
        normalized.includes('INSERT INTO line_types')
      ) {
        return { rows: createdLineTypes, rowCount: createdLineTypes.length };
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
      if (normalized.startsWith('WITH payload_rows AS') &&
          normalized.includes('INSERT INTO city_geometries')) {
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
    release() {
      released = true;
    },
  };
  return {
    queries,
    get released() {
      return released;
    },
    get connections() {
      return connections;
    },
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

test('KML update atomically replaces geometries with line type links', async () => {
  const pool = createPool();
  const service = createKmlUpdateService(pool, config, dependencies);

  const result = await service.update(undefined, {});

  assert.equal(result.importedGeometries, 2);
  assert.equal(result.skippedWithoutCity, 1);
  assert.equal(result.skippedWithoutPlace, 1);
  assert.equal(result.resolvedAmbiguous, 1);
  assert.equal(result.cityBufferMeters, 0);
  assert.equal(result.placesUpdated, 2);
  assert.equal(result.citiesUpdated, 1);
  assert.deepEqual(result.lineTypes, ['default']);
  assert.deepEqual(result.createdLineTypes, []);
  assert.equal(result.updateRunId, 7);
  assert.equal(pool.queries[0], 'BEGIN');
  assert.equal(
    pool.queries.some((query) => query.includes('JOIN line_types AS line_type')),
    true,
  );
  assert.equal(
    pool.queries.some((query) => query === 'DELETE FROM city_geometries'),
    true,
  );
  assert.equal(
    pool.queries.some((query) => query === 'DELETE FROM city_boundaries'),
    false,
  );
  assert.equal(pool.queries.at(-1), 'COMMIT');
  assert.equal(pool.released, true);
});

test('KML automatically creates missing type codes with database default styles', async () => {
  const typedFeatures = features.map((feature, index) => ({
    ...feature,
    lineType: index === 1 ? 'Односторонние' : 'Двусторонние',
  }));
  const createdLineTypes = [
    {
      type: 'Двусторонние',
      name: 'Двусторонние',
      color: '#045b69',
      style: 'solid',
      width: 4,
    },
    {
      type: 'Односторонние',
      name: 'Односторонние',
      color: '#045b69',
      style: 'solid',
      width: 4,
    },
  ];
  const pool = createPool({ createdLineTypes });
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
  assert.deepEqual(result.lineTypes, ['Двусторонние', 'Односторонние']);
  assert.equal(
    pool.queries.some((query) => query.includes('INSERT INTO line_types (code, name)')),
    true,
  );
  assert.equal(pool.queries.at(-1), 'COMMIT');
});

test('KML refuses implicit type creation when its name belongs to another code', async () => {
  const pool = createPool({
    nameConflicts: [{
      requestedCode: 'Двусторонние',
      existingCode: 'two-way',
      existingName: 'двусторонние',
    }],
  });
  const service = createKmlUpdateService(pool, config, {
    ...dependencies,
    parse() {
      return {
        documentName: 'Тест',
        features: features.map((feature) => ({ ...feature, lineType: 'Двусторонние' })),
        selectedPlacemarks: 3,
        ignoredNonLines: 0,
      };
    },
  });

  await assert.rejects(
    service.update(undefined, {}),
    /Use the existing line type code.*two-way|code "two-way"/,
  );
  assert.equal(
    pool.queries.some((query) => query === 'DELETE FROM city_geometries'),
    false,
  );
  assert.equal(pool.queries.at(-1), 'ROLLBACK');
});

test('KML dry run performs matching and type creation only inside rolled-back transaction', async () => {
  const pool = createPool({
    createdLineTypes: [{
      type: 'default',
      name: 'default',
      color: '#045b69',
      style: 'solid',
      width: 4,
    }],
  });
  const service = createKmlUpdateService(pool, config, dependencies);

  const result = await service.update(undefined, { dryRun: 'true' });

  assert.equal(result.dryRun, true);
  assert.equal(result.importedGeometries, 2);
  assert.equal(
    pool.queries.some((query) => query === 'DELETE FROM city_geometries'),
    false,
  );
  assert.equal(pool.queries.at(-1), 'ROLLBACK');
});

test('KML download failure happens before a database connection is opened', async () => {
  const pool = createPool();
  const service = createKmlUpdateService(pool, config, {
    async download() {
      throw new Error('network failed');
    },
  });

  await assert.rejects(service.update(undefined, {}), /network failed/);
  assert.equal(pool.connections, 0);
});
