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
