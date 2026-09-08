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
    properties: { sourceURL: source.URL, layer: 'Слой', placemarkName: 'Первая' },
    geometry: { type: 'LineString', coordinates: [[1, 1], [2, 2]] },
  },
  {
    multiple: 1,
    businessTypeName: 'default',
    fingerprint: 'second',
    properties: { sourceURL: source.URL, layer: 'Слой', placemarkName: 'Вторая' },
    geometry: { type: 'LineString', coordinates: [[3, 3], [4, 4]] },
  },
  {
    multiple: 1,
    businessTypeName: 'default',
    fingerprint: 'unmatched',
    properties: { sourceURL: source.URL, layer: 'Слой', placemarkName: 'Без города' },
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

const defaultMatchRows = [
  {
    inputIndex: 0,
    boundaryId: '11',
    cityId: '1',
    cityName: 'Первый',
    placeName: 'Первый',
    candidateCount: 1,
  },
  {
    inputIndex: 1,
    boundaryId: '12',
    cityId: null,
    cityName: 'Второй',
    placeName: 'Второй',
    candidateCount: 2,
  },
  {
    inputIndex: 2,
    boundaryId: null,
    cityId: null,
    cityName: null,
    placeName: null,
    candidateCount: 0,
  },
];

const defaultResolvedCities = [
  { id: 1, name: 'Первый' },
  { id: 2, name: 'Второй' },
];

function createPool({
  createdLineTypes = [],
  initialTypeRows = [defaultType],
  finalTypeRows = initialTypeRows,
  hasBoundaries = true,
  matchRows = defaultMatchRows,
  resolvedCities = defaultResolvedCities,
} = {}) {
  const queries = [];
  let released = false;
  let connections = 0;
  let loadCount = 0;
  let insertCount = 0;
  let insertedGeometryPayload = null;
  let matchedCityPayload = null;

  const client = {
    async query(text, values = []) {
      const normalized = text.trim();
      queries.push(normalized);

      if (
        normalized.startsWith('WITH requested AS') &&
        normalized.includes('INSERT INTO line_types (name, title)')
      ) {
        insertCount += 1;
        return { rows: createdLineTypes, rowCount: createdLineTypes.length };
      }
      if (
        normalized.startsWith('WITH requested AS') &&
        normalized.includes('requested.name AS "requestedName"')
      ) {
        loadCount += 1;
        const rows = loadCount === 1 ? initialTypeRows : finalTypeRows;
        return { rows, rowCount: rows.length };
      }
      if (normalized === 'SELECT EXISTS (SELECT 1 FROM city_boundaries) AS ready') {
        return { rows: [{ ready: hasBoundaries }], rowCount: 1 };
      }
      if (normalized.includes('LEFT JOIN LATERAL')) {
        return { rows: matchRows, rowCount: matchRows.length };
      }
      if (
        normalized.startsWith('WITH requested AS') &&
        normalized.includes('INSERT INTO cities (')
      ) {
        matchedCityPayload = JSON.parse(values[0]);
        return { rows: resolvedCities, rowCount: resolvedCities.length };
      }
      if (
        normalized.startsWith('WITH requested AS') &&
        normalized.includes('UPDATE city_boundaries AS boundary')
      ) {
        return { rows: [], rowCount: 1 };
      }
      if (
        normalized.startsWith('WITH requested AS') &&
        normalized.includes('SELECT city.id::integer AS id, city.name')
      ) {
        return { rows: resolvedCities, rowCount: resolvedCities.length };
      }
      if (
        normalized.startsWith('WITH payload_rows AS') &&
        normalized.includes('INSERT INTO city_geometries')
      ) {
        insertedGeometryPayload = JSON.parse(values[0]);
        return { rows: [], rowCount: insertedGeometryPayload.length };
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
    get insertCount() { return insertCount; },
    get insertedGeometryPayload() { return insertedGeometryPayload; },
    get matchedCityPayload() { return matchedCityPayload; },
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

function parserFor(nextFeatures) {
  return {
    ...dependencies,
    parse() {
      return {
        documentName: 'Тест',
        features: nextFeatures,
        selectedPlacemarks: nextFeatures.length,
        ignoredNonLines: 0,
      };
    },
  };
}

test('KML matches every imported OSM place and materializes missing city records', async () => {
  const pool = createPool();
  const service = createKmlUpdateService(pool, config, dependencies);

  const result = await service.update(undefined, {});

  assert.equal(result.importedGeometries, 2);
  assert.equal(result.skippedWithoutCity, 1);
  assert.equal(result.resolvedAmbiguous, 1);
  assert.equal(result.citiesUpdated, 2);
  assert.equal(result.lineTypes[0].code, 0);
  assert.equal(result.lineTypes[0].name, 'default');
  assert.deepEqual(result.createdLineTypes, []);
  assert.equal(result.updateRunId, 7);
  assert.equal(pool.queries.some((query) => query === 'DELETE FROM city_geometries'), true);
  assert.equal(pool.queries.some((query) => query.includes('"lineTypeId" bigint')), true);
  assert.deepEqual(
    pool.insertedGeometryPayload.map((row) => row.properties.placemarkName),
    ['Первая', 'Вторая'],
  );
  assert.deepEqual(
    pool.insertedGeometryPayload.map((row) => row.cityId),
    [1, 2],
  );
  assert.deepEqual(pool.matchedCityPayload, [
    { cityName: 'Первый', boundaryId: '11' },
    { cityName: 'Второй', boundaryId: '12' },
  ]);

  const matchStageQuery = pool.queries.find((query) =>
    query.startsWith('CREATE TEMP TABLE kml_place_match_geometries'));
  assert.match(matchStageQuery, /FROM city_boundaries\s*$/);
  assert.doesNotMatch(matchStageQuery, /WHERE city_id IS NOT NULL/);

  const matchQuery = pool.queries.find((query) => query.includes('LEFT JOIN LATERAL'));
  assert.match(matchQuery, /LEFT JOIN cities AS named_city ON named_city\.name = boundary\.osm_name/);
  assert.match(matchQuery, /COALESCE\(boundary\.city_id, named_city\.id\) AS city_id/);
  assert.equal(pool.queries.at(-1), 'COMMIT');
  assert.equal(pool.released, true);
});

test('KML imports lines when all matching OSM boundaries initially have city_id NULL', async () => {
  const pool = createPool({
    matchRows: [
      {
        inputIndex: 0,
        boundaryId: '11',
        cityId: null,
        cityName: 'Первый',
        placeName: 'Первый',
        candidateCount: 1,
      },
      {
        inputIndex: 1,
        boundaryId: '12',
        cityId: null,
        cityName: 'Второй',
        placeName: 'Второй',
        candidateCount: 1,
      },
      {
        inputIndex: 2,
        boundaryId: null,
        cityId: null,
        cityName: null,
        placeName: null,
        candidateCount: 0,
      },
    ],
  });
  const service = createKmlUpdateService(pool, config, dependencies);

  const result = await service.update(undefined, {});

  assert.equal(result.importedGeometries, 2);
  assert.deepEqual(pool.insertedGeometryPayload.map((row) => row.cityId), [1, 2]);
  assert.equal(
    pool.queries.some((query) => query.includes('INSERT INTO cities (')),
    true,
  );
  assert.equal(
    pool.queries.some((query) => query.includes('UPDATE city_boundaries AS boundary')),
    true,
  );
  assert.equal(pool.queries.at(-1), 'COMMIT');
});

test('KML reports empty OSM boundary storage before matching', async () => {
  const pool = createPool({ hasBoundaries: false });
  const service = createKmlUpdateService(pool, config, dependencies);

  await assert.rejects(
    service.update(undefined, {}),
    /OSM place boundaries are empty/,
  );
  assert.equal(
    pool.queries.some((query) =>
      query.startsWith('CREATE TEMP TABLE kml_place_match_geometries')),
    false,
  );
  assert.equal(pool.queries.at(-1), 'ROLLBACK');
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
  const finalTypeRows = createdLineTypes.map((lineType) => ({
    requestedName: lineType.name,
    ...lineType,
  }));
  const pool = createPool({
    createdLineTypes,
    initialTypeRows: [],
    finalTypeRows,
  });
  const service = createKmlUpdateService(pool, config, parserFor(typedFeatures));

  const result = await service.update(undefined, {});

  assert.deepEqual(result.createdLineTypes, createdLineTypes);
  assert.deepEqual(result.lineTypes.map((lineType) => lineType.code), [1, 2]);
  assert.equal(pool.insertCount, 1);
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
  const pool = createPool({ initialTypeRows: [existing] });
  const service = createKmlUpdateService(pool, config, parserFor(typedFeatures));

  const result = await service.update(undefined, {});
  assert.deepEqual(result.createdLineTypes, []);
  assert.equal(result.lineTypes[0].code, 9);
  assert.equal(result.lineTypes[0].title, 'Две стороны');
  assert.equal(pool.insertCount, 0);
});

test('KML dry run uses OSM place names without creating city or line-type records', async () => {
  const typedFeatures = features.map((feature) => ({
    ...feature,
    businessTypeName: 'Новый тип',
  }));
  const pool = createPool({
    initialTypeRows: [],
    matchRows: defaultMatchRows.map((row) => row.boundaryId === null
      ? row
      : { ...row, cityId: null }),
  });
  const service = createKmlUpdateService(pool, config, parserFor(typedFeatures));

  const result = await service.update(undefined, { dryRun: 'true' });

  assert.equal(result.dryRun, true);
  assert.equal(result.importedGeometries, 2);
  assert.equal(result.citiesUpdated, 2);
  assert.deepEqual(result.createdLineTypes, []);
  assert.deepEqual(result.wouldCreateLineTypes, [
    {
      id: null,
      code: null,
      name: 'Новый тип',
      title: 'Новый тип',
      color: '#045b69',
      style: 'solid',
      width: 4,
    },
  ]);
  assert.equal(pool.insertCount, 0);
  assert.equal(
    pool.queries.some((query) => query.includes('INSERT INTO cities (')),
    false,
  );
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
