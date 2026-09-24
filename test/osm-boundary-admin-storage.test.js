import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createOsmBoundaryAdminStorage,
} from '../src/db/osm-boundary-admin-storage.js';

test('OSM boundary admin storage owns list and geometry read models', async () => {
  const calls = [];
  const database = {
    async query(text, values = []) {
      const normalized = text.trim();
      calls.push({ text: normalized, values });
      if (normalized.includes('ST_AsGeoJSON')) {
        return {
          rows: [{
            feature: {
              type: 'Feature',
              id: 5,
            },
          }],
          rowCount: 1,
        };
      }
      return {
        rows: [{
          id: 5,
          population: 120000,
        }],
        rowCount: 1,
      };
    },
  };
  const storage = createOsmBoundaryAdminStorage(database);

  const rows = await storage.list();
  const feature = await storage.getGeometry(5);

  assert.equal(rows[0].population, 120000);
  assert.equal(feature.id, 5);
  assert.match(
    calls[0].text,
    /boundary\.population::integer AS population/u,
  );
  assert.doesNotMatch(
    calls[0].text,
    /JOIN city_populations/u,
  );
  assert.match(calls[1].text, /ST_AsGeoJSON/u);
});

test('OSM boundary admin storage locks subtree recursively and updates only selected ids', async () => {
  const calls = [];
  const client = {
    async query(text, values = []) {
      const normalized = text.trim();
      calls.push({ text: normalized, values });
      if (normalized.startsWith('WITH RECURSIVE subtree AS')) {
        return {
          rows: [
            { id: 5, active: true },
            { id: 6, active: false },
          ],
          rowCount: 2,
        };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  const storage = createOsmBoundaryAdminStorage(client);

  const rows = await storage.lockSubtree(client, 5);
  await storage.updateSubtreeActive(
    client,
    rows.map((row) => row.id),
    false,
  );

  assert.equal(rows.length, 2);
  assert.match(
    calls[0].text,
    /^WITH RECURSIVE subtree AS/u,
  );
  assert.match(
    calls[0].text,
    /FOR UPDATE OF boundary/u,
  );
  assert.match(
    calls[1].text,
    /^UPDATE city_boundaries/u,
  );
  assert.deepEqual(calls[1].values, [[5, 6], false]);
});

test('OSM boundary admin storage keeps territory update scoped to one object', async () => {
  const calls = [];
  const client = {
    async query(text, values = []) {
      calls.push({ text: text.trim(), values });
      return { rows: [], rowCount: 1 };
    },
  };
  const storage = createOsmBoundaryAdminStorage(client);

  await storage.updateBoundary(client, 5, {
    active: false,
    displayName: 'Тестоград',
    displayType: 'city',
    population: 125000,
    populationAsOf: '2026-02-01',
    populationSource: 'test',
    attributes: { census: true },
  });

  assert.match(
    calls[0].text,
    /^UPDATE city_boundaries/u,
  );
  assert.match(calls[0].text, /WHERE id = \$1$/u);
  assert.doesNotMatch(calls[0].text, /WITH RECURSIVE/u);
  assert.doesNotMatch(calls[0].text, /ANY\(/u);
  assert.equal(calls[0].values[1], false);
  assert.equal(calls[0].values[4], 125000);
  assert.equal(calls[0].values[7], '{"census":true}');
});
