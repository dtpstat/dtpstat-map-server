import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDataExportService,
} from '../src/application/data-transfer/export-service.js';

async function collect(source) {
  let result = '';
  for await (const chunk of source) result += chunk;
  return result;
}

test('portable export service frames streamed city snapshot without SQL knowledge', async () => {
  const calls = [];
  const client = {
    async query(text) {
      calls.push(text);
      return { rows: [] };
    },
    release() {
      calls.push('release');
    },
  };
  const storage = {
    async exportedAt() {
      return '2026-09-24T12:00:00.000Z';
    },
    async *streamCityBoundaryItems() {
      yield '{"type":"Feature","properties":{"osmId":"1"}}';
      yield '{"type":"Feature","properties":{"osmId":"2"}}';
    },
  };
  const service = createDataExportService(
    { async connect() { return client; } },
    { storage },
  );

  const payload = JSON.parse(
    await collect(service.streamCityBoundaries()),
  );

  assert.equal(payload.schemaVersion, 2);
  assert.equal(payload.name, 'dtpstat-buslines-cities');
  assert.equal(payload.features.length, 2);
  assert.deepEqual(calls, ['BEGIN READ ONLY', 'ROLLBACK', 'release']);
});

test('portable export service frames line dictionary before streamed features', async () => {
  const client = {
    async query() {
      return { rows: [] };
    },
    release() {},
  };
  const storage = {
    async exportedAt() {
      return '2026-09-24T12:00:00.000Z';
    },
    async lineTypeItems() {
      return [
        '{"code":0,"name":"default"}',
        '{"code":1,"name":"tram"}',
      ];
    },
    async *streamLineItems() {
      yield '{"type":"Feature","properties":{"_dtpstat":{"businessTypeCode":1}}}';
    },
  };
  const service = createDataExportService(
    { async connect() { return client; } },
    { storage },
  );

  const payload = JSON.parse(await collect(service.streamLines()));

  assert.equal(payload.schemaVersion, 3);
  assert.deepEqual(
    payload.lineTypes.map((item) => item.code),
    [0, 1],
  );
  assert.equal(
    payload.features[0].properties._dtpstat.businessTypeCode,
    1,
  );
});

test('portable export service groups non-streaming population rows by stable region identity', async () => {
  const storage = {
    async exportedAt() {
      return '2026-09-24T12:00:00.000Z';
    },
    async populationRows() {
      return {
        rows: [
          {
            regionId: 10,
            regionName: 'Region',
            regionOsmType: 'relation',
            regionOsmId: '100',
            regionAttributes: {},
            cityName: 'One',
            cityOsmType: 'relation',
            cityOsmId: '101',
            population: 10,
            asOf: '2026-01-01',
            source: 'test',
            attributes: {},
          },
          {
            regionId: 10,
            regionName: 'Region',
            regionOsmType: 'relation',
            regionOsmId: '100',
            regionAttributes: {},
            cityName: 'Two',
            cityOsmType: 'way',
            cityOsmId: '102',
            population: null,
            asOf: null,
            source: null,
            attributes: {},
          },
        ],
      };
    },
  };
  const service = createDataExportService(
    { async query() { throw new Error('storage should own SQL'); } },
    { storage },
  );

  const payload = await service.exportPopulations();

  assert.equal(payload.schemaVersion, 3);
  assert.equal(payload.regions.length, 1);
  assert.equal(payload.regions[0].osmId, '100');
  assert.equal(payload.regions[0].cities.length, 2);
  assert.equal(payload.regions[0].cities[1].osmType, 'way');
});
