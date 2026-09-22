import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createOsmBoundaryAdminRepository,
  OsmBoundaryAdminValidationError,
} from '../src/db/osm-boundary-admin-repository.js';

function createPool({
  currentActive = true,
  currentCityId = 17,
  currentPopulation = 120000,
  resolvedCityId = currentCityId,
  finalPopulation = currentPopulation,
  finalActive = currentActive,
  subtreeRows = null,
} = {}) {
  const queries = [];
  const parameters = [];
  let released = false;

  const client = {
    async query(text, values = []) {
      const normalized = text.trim();
      queries.push(normalized);
      parameters.push(values);

      if (/^WITH RECURSIVE subtree AS/i.test(normalized)) {
        const rows = subtreeRows ?? [{ id: 5, active: currentActive }];
        return { rows, rowCount: rows.length };
      }

      if (/FOR UPDATE OF boundary/i.test(normalized)) {
        return {
          rows: [{
            id: 5,
            active: currentActive,
            displayName: 'Тестоград',
            displayType: 'city',
            cityId: currentCityId,
            population: currentPopulation,
          }],
          rowCount: 1,
        };
      }

      if (/^SELECT city_id::integer AS "cityId"/i.test(normalized)) {
        return { rows: [{ cityId: resolvedCityId }], rowCount: 1 };
      }

      if (
        /^SELECT\s+boundary\.id::integer AS id/i.test(normalized) &&
        /population\.population::integer AS population/i.test(normalized)
      ) {
        return {
          rows: [{
            id: 5,
            parentId: null,
            osmType: 'relation',
            osmId: '123',
            osmName: 'Тестоград',
            placeType: 'city',
            adminLevel: null,
            active: finalActive,
            displayName: 'Тестоград',
            displayType: 'city',
            areaKm2: 100,
            cityId: resolvedCityId,
            population: finalPopulation,
            populationAsOf: null,
            populationSource: null,
            tags: {},
            updatedAt: '2026-09-20T00:00:00.000Z',
          }],
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
    databaseSchema: 'test',
    queries,
    parameters,
    get released() { return released; },
    async query(text, values = []) {
      queries.push(text.trim());
      parameters.push(values);
      return {
        rows: [{
          id: 5,
          cityId: 17,
          population: 120000,
          populationAsOf: '2026-01-01',
          populationSource: 'test',
        }],
        rowCount: 1,
      };
    },
    async connect() {
      return client;
    },
  };
}

test('OSM boundary list exposes linked population metadata', async () => {
  const pool = createPool();
  const repository = createOsmBoundaryAdminRepository(pool);

  const rows = await repository.list();

  assert.equal(rows[0].population, 120000);
  assert.match(pool.queries[0], /LEFT JOIN city_populations AS population/i);
  assert.match(pool.queries[0], /population\.as_of AS "populationAsOf"/i);
});

test('OSM boundary update upserts population for the active linked city', async () => {
  const pool = createPool({ finalPopulation: 125000 });
  const repository = createOsmBoundaryAdminRepository(pool);

  const result = await repository.update(5, { population: 125000 });

  assert.equal(result.population, 125000);
  const index = pool.queries.findIndex((query) =>
    query.startsWith('INSERT INTO city_populations'));
  assert.ok(index >= 0);
  assert.deepEqual(pool.parameters[index], [17, 125000]);
  assert.ok(pool.queries.some((query) => /^WITH geometry_statistics AS/i.test(query)));
  assert.equal(pool.queries.at(-1), 'COMMIT');
  assert.equal(pool.released, true);
});

test('inactive OSM boundary can be activated and receive population atomically', async () => {
  const pool = createPool({
    currentActive: false,
    currentCityId: null,
    currentPopulation: null,
    resolvedCityId: 42,
    finalPopulation: 1000,
    finalActive: true,
  });
  const repository = createOsmBoundaryAdminRepository(pool);

  const result = await repository.update(5, {
    active: true,
    population: 1000,
  });

  assert.equal(result.active, true);
  assert.equal(result.cityId, 42);
  assert.equal(result.population, 1000);
  assert.ok(pool.queries.includes('SELECT sync_active_boundary_cities()'));
  const populationIndex = pool.queries.findIndex((query) =>
    query.startsWith('INSERT INTO city_populations'));
  assert.ok(populationIndex >= 0);
  assert.deepEqual(pool.parameters[populationIndex], [42, 1000]);
  assert.equal(pool.queries.at(-1), 'COMMIT');
});

test('activating one OSM object never activates parents or descendants', async () => {
  const pool = createPool({
    currentActive: false,
    finalActive: true,
  });
  const repository = createOsmBoundaryAdminRepository(pool);

  const result = await repository.update(5, { active: true });

  assert.equal(result.active, true);
  const updateIndex = pool.queries.findIndex((query) =>
    /^UPDATE city_boundaries[\s\S]*SET is_active = \$2/i.test(query));
  assert.ok(updateIndex >= 0);
  assert.match(pool.queries[updateIndex], /WHERE id = \$1$/i);
  assert.doesNotMatch(pool.queries[updateIndex], /parent_id|WITH RECURSIVE|ANY\(/i);
  assert.deepEqual(pool.parameters[updateIndex], [5, true, 'Тестоград', 'city']);
  assert.equal(
    pool.queries.some((query) => /^WITH RECURSIVE subtree AS/i.test(query)),
    false,
  );
});

test('OSM boundary update can explicitly clear population', async () => {
  const pool = createPool({ finalPopulation: null });
  const repository = createOsmBoundaryAdminRepository(pool);

  const result = await repository.update(5, { population: null });

  assert.equal(result.population, null);
  const index = pool.queries.findIndex((query) =>
    query === 'DELETE FROM city_populations WHERE city_id = $1');
  assert.ok(index >= 0);
  assert.deepEqual(pool.parameters[index], [17]);
});

test('population cannot be edited while the OSM boundary is inactive', async () => {
  const pool = createPool({ currentActive: false });
  const repository = createOsmBoundaryAdminRepository(pool);

  await assert.rejects(
    repository.update(5, { active: false, population: 1000 }),
    (error) =>
      error instanceof OsmBoundaryAdminValidationError &&
      /only be edited for an active OSM boundary/.test(error.message),
  );

  assert.equal(pool.queries.at(-1), 'ROLLBACK');
  assert.equal(pool.released, true);
});


test('OSM subtree deactivation updates the selected node and every descendant once', async () => {
  const pool = createPool({
    finalActive: false,
    subtreeRows: [
      { id: 5, active: true },
      { id: 6, active: true },
      { id: 7, active: false },
    ],
  });
  const repository = createOsmBoundaryAdminRepository(pool);

  const result = await repository.setSubtreeActive(5, false);

  assert.equal(result.active, false);
  assert.equal(result.affectedCount, 3);
  assert.equal(result.changedCount, 2);
  assert.equal(result.previousActiveCount, 2);
  assert.equal(result.previousInactiveCount, 1);
  assert.equal(result.root.active, false);

  const updateIndex = pool.queries.findIndex((query) =>
    /UPDATE city_boundaries[\s\S]*ANY\(\$1::bigint\[\]\)/i.test(query));
  assert.ok(updateIndex >= 0);
  assert.deepEqual(pool.parameters[updateIndex], [[5, 6, 7], false]);
  assert.ok(pool.queries.includes('SELECT sync_active_boundary_cities()'));
  assert.ok(pool.queries.some((query) => /^WITH geometry_statistics AS/i.test(query)));
  assert.equal(pool.queries.at(-1), 'COMMIT');
  assert.equal(pool.released, true);
});

test('OSM subtree activation returns null for a missing root without derived updates', async () => {
  const pool = createPool({ subtreeRows: [] });
  const repository = createOsmBoundaryAdminRepository(pool);

  const result = await repository.setSubtreeActive(999, false);

  assert.equal(result, null);
  assert.equal(
    pool.queries.some((query) => query.startsWith('UPDATE city_boundaries')),
    false,
  );
  assert.equal(pool.queries.at(-1), 'ROLLBACK');
  assert.equal(pool.released, true);
});

test('OSM subtree activation validates boolean state before opening a transaction', async () => {
  const pool = createPool();
  const repository = createOsmBoundaryAdminRepository(pool);

  await assert.rejects(
    repository.setSubtreeActive(5, 'false'),
    (error) =>
      error instanceof OsmBoundaryAdminValidationError &&
      /active must be boolean/.test(error.message),
  );

  assert.equal(pool.queries.length, 0);
  assert.equal(pool.released, false);
});
