import assert from 'node:assert/strict';
import test from 'node:test';
import { createDataExportRepository } from '../src/db/data-export-repository.js';

test('population export mirrors boundary parent hierarchy and keeps inactive data', async () => {
  const database = {
    async query(text) {
      if (text.includes('SELECT now() AS "exportedAt"')) {
        return { rows: [{ exportedAt: '2026-09-22T12:00:00.000Z' }] };
      }
      if (text.includes('WITH RECURSIVE territory_tree AS')) {
        return {
          rows: [
            {
              id: 1,
              parentId: null,
              depth: 0,
              hasChildren: true,
              osmType: 'relation',
              osmId: '100',
              name: 'Область',
              type: 'administrative',
              placeType: null,
              adminLevel: 4,
              population: 2000000,
              asOf: '2026-01-01',
              source: 'test',
              attributes: { code: 'R1' },
            },
            {
              id: 2,
              parentId: 1,
              depth: 1,
              hasChildren: false,
              osmType: 'relation',
              osmId: '200',
              name: 'Город',
              type: 'city',
              placeType: 'city',
              adminLevel: 6,
              population: 300000,
              asOf: '2026-01-01',
              source: 'test',
              attributes: {},
            },
          ],
        };
      }
      throw new Error(`Unexpected SQL: ${text}`);
    },
  };

  const repository = createDataExportRepository(database);
  const payload = await repository.exportPopulations();

  assert.equal(payload.schemaVersion, 2);
  assert.equal(payload.territories.length, 1);
  assert.equal(payload.territories[0].osmId, '100');
  assert.equal(payload.territories[0].children.length, 1);
  assert.equal(payload.territories[0].children[0].osmId, '200');
  assert.equal(payload.territories[0].children[0].population, 300000);
  assert.equal('active' in payload.territories[0], false);
});


async function collect(source) {
  const chunks = [];
  for await (const chunk of source) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

test('streaming population export emits the same nested hierarchy', async () => {
  const rows = [
    {
      id: 1,
      parentId: null,
      depth: 0,
      hasChildren: true,
      osmType: 'relation',
      osmId: '100',
      name: 'Область',
      type: 'administrative',
      placeType: null,
      adminLevel: 4,
      population: 2000000,
      asOf: '2026-01-01',
      source: 'test',
      attributes: {},
    },
    {
      id: 2,
      parentId: 1,
      depth: 1,
      hasChildren: true,
      osmType: 'relation',
      osmId: '200',
      name: 'Район',
      type: 'administrative',
      placeType: null,
      adminLevel: 6,
      population: 500000,
      asOf: '2026-01-01',
      source: 'test',
      attributes: {},
    },
    {
      id: 3,
      parentId: 2,
      depth: 2,
      hasChildren: false,
      osmType: 'relation',
      osmId: '300',
      name: 'Город',
      type: 'city',
      placeType: 'city',
      adminLevel: 8,
      population: 100000,
      asOf: '2026-01-01',
      source: 'test',
      attributes: {},
    },
    {
      id: 4,
      parentId: 1,
      depth: 1,
      hasChildren: false,
      osmType: 'relation',
      osmId: '400',
      name: 'Другой район',
      type: 'administrative',
      placeType: null,
      adminLevel: 6,
      population: null,
      asOf: null,
      source: null,
      attributes: {},
    },
    {
      id: 5,
      parentId: null,
      depth: 0,
      hasChildren: false,
      osmType: 'relation',
      osmId: '500',
      name: 'Вторая область',
      type: 'administrative',
      placeType: null,
      adminLevel: 4,
      population: null,
      asOf: null,
      source: null,
      attributes: {},
    },
  ];

  let fetchCount = 0;
  const client = {
    async query(text) {
      const normalized = text.trim();
      if (normalized === 'BEGIN READ ONLY') return { rows: [] };
      if (normalized === 'SELECT now() AS "exportedAt"') {
        return { rows: [{ exportedAt: '2026-09-22T12:00:00.000Z' }] };
      }
      if (normalized.startsWith('DECLARE portable_population_export')) {
        return { rows: [] };
      }
      if (normalized.startsWith('FETCH FORWARD')) {
        fetchCount += 1;
        return fetchCount === 1
          ? { rows }
          : { rows: [] };
      }
      if (
        normalized === 'CLOSE portable_population_export' ||
        normalized === 'ROLLBACK'
      ) {
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL: ${normalized}`);
    },
    release() {},
  };
  const database = {
    async connect() { return client; },
  };

  const repository = createDataExportRepository(database);
  const payload = JSON.parse(await collect(repository.streamPopulations()));

  assert.equal(payload.schemaVersion, 2);
  assert.equal(payload.territories.length, 2);
  assert.equal(payload.territories[0].children.length, 2);
  assert.equal(
    payload.territories[0].children[0].children[0].osmId,
    '300',
  );
  assert.equal(payload.territories[0].children[1].osmId, '400');
  assert.deepEqual(payload.territories[0].children[1].children, []);
  assert.equal(payload.territories[1].osmId, '500');
  assert.deepEqual(payload.territories[1].children, []);
});
