import assert from 'node:assert/strict';
import test from 'node:test';
import { createPopulationImportService } from '../src/db/population-import-service.js';

const upload = {
  schemaVersion: 2,
  asOf: '2026-01-01',
  source: 'test',
  regions: [{
    name: 'Тестовая область',
    attributes: { federalDistrict: 'Тестовый округ' },
    cities: [{
      name: 'Тестоград',
      population: 2000,
      attributes: {},
    }],
  }],
};

function createFakePool({
  statuses = null,
  updatedRegions = null,
  updatedCities = null,
} = {}) {
  const queries = [];
  const rawRows = [];
  const stageRows = [];
  let released = false;

  const client = {
    async query(text, values = []) {
      const normalized = text.trim();
      queries.push(normalized);

      if (normalized.startsWith('INSERT INTO population_transfer_raw')) {
        const rows = values[0] ? JSON.parse(values[0]) : [];
        rawRows.push(...rows);
        return { rows: [], rowCount: rows.length };
      }
      if (normalized.startsWith('INSERT INTO population_transfer_stage')) {
        const rows = values[0] ? JSON.parse(values[0]) : [];
        stageRows.push(...rows);
        return { rows: [], rowCount: rows.length };
      }
      if (
        normalized.startsWith('SELECT seq::text AS seq, item') &&
        normalized.includes('FROM population_transfer_raw')
      ) {
        const after = Number(values[0]);
        const limit = Number(values[1]);
        const rows = rawRows
          .filter((row) => Number(row.seq) > after)
          .sort((a, b) => Number(a.seq) - Number(b.seq))
          .slice(0, limit)
          .map((row) => ({ seq: String(row.seq), item: row.item }));
        return { rows, rowCount: rows.length };
      }
      if (
        normalized.startsWith('SELECT') &&
        normalized.includes('FROM population_transfer_resolved')
      ) {
        const rows = statuses ?? stageRows.map((row) => ({
          regionName: row.regionName,
          cityName: row.cityName,
          status: 'matched',
        }));
        return { rows, rowCount: rows.length };
      }
      if (
        normalized.startsWith('UPDATE city_boundaries AS boundary') &&
        normalized.includes('source.region_attributes')
      ) {
        const count = updatedRegions ??
          new Set(stageRows.map((row) => row.regionName)).size;
        return {
          rows: Array.from({ length: count }, (_v, index) => ({ id: index + 1 })),
          rowCount: count,
        };
      }
      if (
        normalized.startsWith('UPDATE city_boundaries AS boundary') &&
        normalized.includes('population = stage.population')
      ) {
        const matched = statuses === null
          ? stageRows.length
          : statuses.filter((row) => row.status === 'matched').length;
        const count = updatedCities ?? matched;
        return {
          rows: Array.from({ length: count }, (_v, index) => ({ id: index + 1 })),
          rowCount: count,
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
    rawRows,
    stageRows,
    get released() { return released; },
    async connect() { return client; },
  };
}

test('population update matches city names inside a named region', async () => {
  const pool = createFakePool();
  const service = createPopulationImportService(pool);

  const result = await service.updateFromJson(upload);

  assert.equal(result.regions, 1);
  assert.equal(result.requestedRegions, 1);
  assert.equal(result.cities, 1);
  assert.equal(result.requestedCities, 1);
  assert.equal(result.skippedCount, 0);
  assert.equal(result.partial, false);
  assert.deepEqual(result.skippedCities, []);
  assert.equal(result.asOf, '2026-01-01');
  assert.equal(pool.queries[0], 'BEGIN');
  assert.ok(
    pool.queries.some((query) =>
      query.startsWith('CREATE TEMP TABLE population_transfer_resolved')),
  );
  assert.ok(pool.queries.includes('SELECT sync_active_boundary_populations()'));
  assert.match(pool.queries.at(-2), /^WITH geometry_statistics AS/);
  assert.equal(pool.queries.at(-1), 'COMMIT');
  assert.equal(pool.released, true);
});

test('missing and ambiguous names are skipped and valid cities still commit', async () => {
  const statuses = [
    {
      regionName: 'Тестовая область',
      cityName: 'Тестоград',
      status: 'matched',
    },
    {
      regionName: 'Тестовая область',
      cityName: 'Нет в БД',
      status: 'city-missing',
    },
    {
      regionName: 'Тестовая область',
      cityName: 'Дубль в БД',
      status: 'city-ambiguous',
    },
  ];
  const pool = createFakePool({
    statuses,
    updatedCities: 1,
  });
  const service = createPopulationImportService(pool);
  const mixed = {
    ...upload,
    regions: [{
      ...upload.regions[0],
      cities: [
        upload.regions[0].cities[0],
        { name: 'Нет в БД', population: 1000, attributes: {} },
        { name: 'Дубль в БД', population: 2000, attributes: {} },
      ],
    }],
  };
  const progress = [];

  const result = await service.updateFromJson(mixed, {
    onProgress(value) { progress.push(value); },
  });

  assert.equal(result.cities, 1);
  assert.equal(result.requestedCities, 3);
  assert.equal(result.skippedCount, 2);
  assert.equal(result.warningCount, 2);
  assert.equal(result.partial, true);
  assert.deepEqual(
    result.skippedCities,
    [
      'Тестовая область / Нет в БД',
      'Тестовая область / Дубль в БД',
    ],
  );
  assert.ok(result.warnings.some((item) => item.code === 'city-missing'));
  assert.ok(result.warnings.some((item) => item.code === 'city-ambiguous'));
  assert.ok(progress.some((item) =>
    item.phase === 'warnings' &&
    item.warningCount === 2 &&
    item.skippedCount === 2));
  assert.equal(pool.queries.at(-1), 'COMMIT');
  assert.equal(pool.queries.includes('ROLLBACK'), false);
});

test('invalid individual city is skipped before database staging', async () => {
  const pool = createFakePool();
  const service = createPopulationImportService(pool);
  const mixed = {
    ...upload,
    regions: [{
      ...upload.regions[0],
      cities: [
        upload.regions[0].cities[0],
        { name: 'Плохой', population: 0, attributes: {} },
      ],
    }],
  };

  const result = await service.updateFromJson(mixed);

  assert.equal(result.cities, 1);
  assert.equal(result.requestedCities, 2);
  assert.equal(result.normalizedCities, 1);
  assert.equal(result.skippedCount, 1);
  assert.equal(result.partial, true);
  assert.equal(pool.stageRows.length, 1);
  assert.equal(pool.stageRows[0].cityName, 'Тестоград');
  assert.equal(pool.queries.at(-1), 'COMMIT');
});

test('streamed population cursor keeps numeric region order without rereading', async () => {
  const regions = Array.from({ length: 12 }, (_value, index) => ({
    name: `Область ${index}`,
    attributes: {},
    cities: [{
      name: `Город ${index}`,
      population: 1000 + index,
      attributes: {},
    }],
  }));
  const document = JSON.stringify({
    schemaVersion: 2,
    regions,
  });

  async function* source() {
    const buffer = Buffer.from(document);
    for (let offset = 0; offset < buffer.length; offset += 37) {
      yield buffer.subarray(offset, offset + 37);
    }
  }

  const pool = createFakePool();
  const service = createPopulationImportService(pool);
  const progress = [];
  const result = await service.updateFromJsonStream(source(), {
    maxJsonBytes: Buffer.byteLength(document) + 1,
    maxItemBytes: 1024 * 1024,
    maxJsonItems: 1000,
    maxJsonDepth: 128,
    onProgress(value) { progress.push(value); },
  });

  assert.equal(result.requestedRegions, 12);
  assert.equal(result.requestedCities, 12);
  assert.equal(result.cities, 12);
  assert.equal(result.warningCount, 0);
  assert.deepEqual(
    progress
      .filter((item) => item.phase === 'normalize-stage')
      .map((item) => item.processedRegions),
    Array.from({ length: 12 }, (_value, index) => index + 1),
  );
  const cursorSql = pool.queries.find((query) =>
    query.includes('FROM population_transfer_raw') &&
    query.includes('SELECT seq::text AS seq, item'));
  assert.match(cursorSql, /WHERE seq > \$1::bigint/);
  assert.match(cursorSql, /ORDER BY population_transfer_raw\.seq/);
});

test('streamed population import rolls back when JSON fails late', async () => {
  const regions = Array.from({ length: 101 }, (_value, index) => ({
    name: `Область ${index}`,
    attributes: {},
    cities: [{
      name: `Город ${index}`,
      population: 1000 + index,
      attributes: {},
    }],
  }));
  const malformed =
    '{"schemaVersion":2,"regions":' +
    JSON.stringify(regions) +
    ',"broken":';

  async function* source() {
    const buffer = Buffer.from(malformed);
    for (let offset = 0; offset < buffer.length; offset += 97) {
      yield buffer.subarray(offset, offset + 97);
    }
  }

  const pool = createFakePool();
  const service = createPopulationImportService(pool);

  await assert.rejects(
    service.updateFromJsonStream(source(), {
      maxJsonBytes: Buffer.byteLength(malformed) + 1,
      maxItemBytes: 1024 * 1024,
      maxJsonItems: 1000,
      maxJsonDepth: 128,
    }),
    /Unexpected end|JSON value/,
  );

  assert.equal(pool.queries[0], 'BEGIN');
  assert.equal(
    pool.queries.filter((query) =>
      query.startsWith('INSERT INTO population_transfer_raw')).length,
    1,
  );
  assert.equal(pool.queries.at(-1), 'ROLLBACK');
  assert.equal(pool.queries.includes('COMMIT'), false);
  assert.equal(pool.released, true);
});


test('schema v3 stages OSM identity and resolution keeps name fallback optional', async () => {
  const pool = createFakePool();
  const service = createPopulationImportService(pool);
  const payload = {
    schemaVersion: 3,
    regions: [{
      name: 'Тестовая область',
      osmType: 'relation',
      osmId: '1001',
      attributes: { source: 'manual' },
      cities: [
        {
          name: 'Тестоград',
          osmType: 'relation',
          osmId: '2001',
          population: 1234,
          asOf: '2026-01-01',
          source: 'ручная правка',
          attributes: { note: 'exact' },
        },
        {
          name: 'Город старого формата',
          population: 5678,
          attributes: { note: 'fallback' },
        },
      ],
    }],
  };

  const result = await service.updateFromJson(payload);

  assert.equal(result.cities, 2);
  assert.equal(result.skippedCount, 0);
  assert.deepEqual(
    pool.stageRows.map((row) => ({
      regionOsmType: row.regionOsmType,
      regionOsmId: row.regionOsmId,
      cityOsmType: row.cityOsmType,
      cityOsmId: row.cityOsmId,
      population: row.population,
      asOf: row.asOf,
      source: row.source,
      attributes: row.attributes,
    })),
    [
      {
        regionOsmType: 'relation',
        regionOsmId: '1001',
        cityOsmType: 'relation',
        cityOsmId: '2001',
        population: 1234,
        asOf: '2026-01-01',
        source: 'ручная правка',
        attributes: { note: 'exact' },
      },
      {
        regionOsmType: 'relation',
        regionOsmId: '1001',
        cityOsmType: null,
        cityOsmId: null,
        population: 5678,
        asOf: null,
        source: null,
        attributes: { note: 'fallback' },
      },
    ],
  );

  const resolutionSql = pool.queries.find((query) =>
    query.startsWith('CREATE TEMP TABLE population_transfer_resolved'));
  assert.match(
    resolutionSql,
    /boundary\.osm_type = stage_region\.region_osm_type/,
  );
  assert.match(
    resolutionSql,
    /stage_region\.region_osm_type IS NULL[\s\S]*NORMALIZE_NAME_SQL|stage_region\.region_osm_type IS NULL[\s\S]*regexp_replace/u,
  );
  assert.match(
    resolutionSql,
    /boundary\.osm_type = stage\.city_osm_type/,
  );
  assert.match(
    resolutionSql,
    /stage\.city_osm_type IS NULL[\s\S]*stage\.city_name/u,
  );
});

test('same names with different OSM identities are not collapsed during import', async () => {
  const pool = createFakePool({
    updatedRegions: 2,
    updatedCities: 2,
  });
  const service = createPopulationImportService(pool);
  const payload = {
    schemaVersion: 3,
    regions: [
      {
        name: 'Севастополь',
        osmType: 'relation',
        osmId: '100',
        cities: [{
          name: 'Алексеевка',
          osmType: 'relation',
          osmId: '200',
          population: 1000,
        }],
      },
      {
        name: 'Севастополь',
        osmType: 'relation',
        osmId: '101',
        cities: [{
          name: 'Алексеевка',
          osmType: 'relation',
          osmId: '201',
          population: 2000,
        }],
      },
    ],
  };

  const result = await service.updateFromJson(payload);

  assert.equal(result.requestedRegions, 2);
  assert.equal(result.uniqueRegions, 2);
  assert.equal(result.requestedCities, 2);
  assert.equal(result.normalizedCities, 2);
  assert.equal(result.cities, 2);
  assert.equal(result.warningCount, 0);
  assert.equal(result.partial, false);
  assert.equal(pool.stageRows.length, 2);
});

test('legacy schema v2 without OSM identity remains supported', async () => {
  const pool = createFakePool();
  const service = createPopulationImportService(pool);

  const result = await service.updateFromJson(upload);

  assert.equal(result.cities, 1);
  assert.equal(result.partial, false);
  assert.equal(pool.stageRows[0].regionOsmType, null);
  assert.equal(pool.stageRows[0].regionOsmId, null);
  assert.equal(pool.stageRows[0].cityOsmType, null);
  assert.equal(pool.stageRows[0].cityOsmId, null);
});


test('v2+ name fallback uses OSM aliases and linked application city names', async () => {
  const pool = createFakePool();
  const service = createPopulationImportService(pool);
  const payload = {
    schemaVersion: 2,
    regions: [{
      name: 'Республика Татарстан',
      attributes: {},
      cities: [{
        name: 'Казань',
        population: 1318604,
        attributes: {},
      }],
    }],
  };

  await service.updateFromJson(payload);

  const resolutionSql = pool.queries.find((query) =>
    query.startsWith('CREATE TEMP TABLE population_transfer_resolved'));
  assert.ok(resolutionSql);

  for (const alias of [
    "boundary.osm_name",
    "boundary.tags ->> 'name:ru'",
    "boundary.tags ->> 'official_name:ru'",
    "boundary.tags ->> 'official_name'",
    "boundary.tags ->> 'short_name:ru'",
    "boundary.tags ->> 'loc_name:ru'",
    "boundary.tags ->> 'alt_name:ru'",
    "boundary.tags ->> 'alt_name'",
  ]) {
    assert.match(resolutionSql, new RegExp(
      alias.replace(/[.*+?^$\{\}()|[\]\\]/g, '\\test('legacy schema v2 without OSM identity remains supported', async () => {
  const pool = createFakePool();
  const service = createPopulationImportService(pool);

  const result = await service.updateFromJson(upload);

  assert.equal(result.cities, 1);
  assert.equal(result.partial, false);
  assert.equal(pool.stageRows[0].regionOsmType, null);
  assert.equal(pool.stageRows[0].regionOsmId, null);
  assert.equal(pool.stageRows[0].cityOsmType, null);
  assert.equal(pool.stageRows[0].cityOsmId, null);
});
'),
    ));
  }

  assert.match(resolutionSql, /boundary\.tags \? 'ISO3166-2'/);
  assert.match(resolutionSql, /DENSE_RANK\(\) OVER/);
  assert.match(resolutionSql, /application_city\.name/);
  assert.match(resolutionSql, /application_city\.full_name/);
  assert.match(
    resolutionSql,
    /boundary\.place_type IN \('city', 'town'\)[\s\S]*OR boundary\.city_id IS NOT NULL/,
  );
  assert.match(
    resolutionSql,
    /WHEN boundary\.city_id IS NOT NULL THEN 0/,
  );
  assert.match(
    resolutionSql,
    /WHEN boundary\.is_active THEN 0/,
  );
});

test('v3 entries without OSM identity use the same v2+ name fallback', async () => {
  const pool = createFakePool();
  const service = createPopulationImportService(pool);
  const payload = {
    schemaVersion: 3,
    regions: [{
      name: 'Республика Башкортостан',
      cities: [{
        name: 'Уфа',
        population: 1163304,
      }],
    }],
  };

  const result = await service.updateFromJson(payload);

  assert.equal(result.cities, 1);
  assert.equal(result.partial, false);
  assert.equal(pool.stageRows[0].regionOsmId, null);
  assert.equal(pool.stageRows[0].cityOsmId, null);
});

test('mixed exact and name-only entries resolving to one boundary skip duplicate target', async () => {
  const statuses = [
    {
      regionName: 'Тестовая область',
      cityName: 'Тестоград',
      status: 'matched',
    },
    {
      regionName: 'Тестовая область',
      cityName: 'Тестоград',
      status: 'city-duplicate-target',
    },
  ];
  const pool = createFakePool({
    statuses,
    updatedRegions: 1,
    updatedCities: 1,
  });
  const service = createPopulationImportService(pool);
  const payload = {
    schemaVersion: 3,
    regions: [{
      name: 'Тестовая область',
      osmType: 'relation',
      osmId: '1001',
      cities: [
        {
          name: 'Тестоград',
          osmType: 'relation',
          osmId: '2001',
          population: 1000,
        },
        {
          name: 'Тестоград',
          population: 2000,
        },
      ],
    }],
  };

  const result = await service.updateFromJson(payload);

  assert.equal(result.cities, 1);
  assert.equal(result.skippedCount, 1);
  assert.equal(result.partial, true);
  assert.ok(result.warnings.some((item) =>
    item.code === 'city-duplicate-target'));
});


test('streaming population import preserves schema v3 OSM identity', async () => {
  const payload = {
    schemaVersion: 3,
    regions: [{
      name: 'Регион',
      osmType: 'relation',
      osmId: '9001',
      cities: [{
        name: 'Город',
        osmType: 'way',
        osmId: '9002',
        population: 4321,
        asOf: '2026-09-01',
        source: 'manual',
        attributes: { edited: true },
      }],
    }],
  };
  const document = JSON.stringify(payload);
  async function* source() {
    const buffer = Buffer.from(document);
    for (let offset = 0; offset < buffer.length; offset += 23) {
      yield buffer.subarray(offset, offset + 23);
    }
  }

  const pool = createFakePool();
  const service = createPopulationImportService(pool);
  const result = await service.updateFromJsonStream(source(), {
    maxJsonBytes: Buffer.byteLength(document) + 1,
    maxItemBytes: 1024 * 1024,
    maxJsonItems: 1000,
    maxJsonDepth: 128,
  });

  assert.equal(result.cities, 1);
  assert.equal(result.partial, false);
  assert.equal(pool.stageRows.length, 1);
  assert.deepEqual(
    {
      regionOsmType: pool.stageRows[0].regionOsmType,
      regionOsmId: pool.stageRows[0].regionOsmId,
      cityOsmType: pool.stageRows[0].cityOsmType,
      cityOsmId: pool.stageRows[0].cityOsmId,
      population: pool.stageRows[0].population,
      asOf: pool.stageRows[0].asOf,
      source: pool.stageRows[0].source,
      attributes: pool.stageRows[0].attributes,
    },
    {
      regionOsmType: 'relation',
      regionOsmId: '9001',
      cityOsmType: 'way',
      cityOsmId: '9002',
      population: 4321,
      asOf: '2026-09-01',
      source: 'manual',
      attributes: { edited: true },
    },
  );
});
