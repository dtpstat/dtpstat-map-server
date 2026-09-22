import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createOsmBoundaryAdminRepository,
  OsmBoundaryAdminValidationError,
} from '../src/db/osm-boundary-admin-repository.js';

function createPool({
  currentActive = true,
  currentPopulation = 120000,
  finalPopulation = currentPopulation,
  finalActive = currentActive,
  subtreeRows = null,
} = {}) {
  const queries = [];
  const parameters = [];
  let released = false;

  const finalRow = () => ({
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
    cityId: finalActive ? 17 : null,
    population: finalPopulation,
    populationAsOf: '2026-01-01',
    populationSource: 'test',
    attributes: { note: 'x' },
    tags: {},
    updatedAt: '2026-09-20T00:00:00.000Z',
  });

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
            population: currentPopulation,
            populationAsOf: '2026-01-01',
            populationSource: 'test',
            attributes: { note: 'x' },
          }],
          rowCount: 1,
        };
      }

      if (
        /^SELECTs+boundary.id::integer AS id/i.test(normalized) &&
        /boundary.population::integer AS population/i.test(normalized)
      ) {
        return { rows: [finalRow()], rowCount: 1 };
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
      return { rows: [finalRow()], rowCount: 1 };
    },
    async connect() {
      return client;
    },
  };
}

test('OSM boundary list reads population metadata from the boundary itself', async () => {
  const pool = createPool();
  const repository = createOsmBoundaryAdminRepository(pool);

  const rows = await repository.list();

  assert.equal(rows[0].population, 120000);
  assert.match(pool.queries[0], /boundary.population::integer AS population/i);
  assert.match(pool.queries[0], /boundary.population_as_of AS "populationAsOf"/i);
  assert.doesNotMatch(pool.queries[0], /JOIN city_populations/i);
});

test('population can be edited on an inactive OSM boundary without activating it', async () => {
  const pool = createPool({
    currentActive: false,
    currentPopulation: null,
    finalPopulation: 125000,
    finalActive: false,
  });
  const repository = createOsmBoundaryAdminRepository(pool);

  const result = await repository.update(5, { population: 125000 });

  assert.equal(result.population, 125000);
  assert.equal(result.active, false);

  const updateIndex = pool.queries.findIndex((query) =>
    /^UPDATE city_boundaries/i.test(query),
  );
  assert.ok(updateIndex >= 0);
  assert.equal(pool.parameters[updateIndex][1], false);
  assert.equal(pool.parameters[updateIndex][4], 125000);
  assert.ok(
    pool.queries.includes('SELECT sync_active_boundary_populations()'),
  );
  assert.equal(pool.queries.at(-1), 'COMMIT');
  assert.equal(pool.released, true);
});

test('active state can change without modifying territory population', async () => {
  const pool = createPool({
    currentActive: false,
    currentPopulation: 1000,
    finalPopulation: 1000,
    finalActive: true,
  });
  const repository = createOsmBoundaryAdminRepository(pool);

  const result = await repository.update(5, { active: true });

  assert.equal(result.active, true);
  assert.equal(result.population, 1000);
  const updateIndex = pool.queries.findIndex((query) =>
    /^UPDATE city_boundaries/i.test(query),
  );
  assert.equal(pool.parameters[updateIndex][1], true);
  assert.equal(pool.parameters[updateIndex][4], 1000);
});

test('OSM boundary update can explicitly clear population while inactive', async () => {
  const pool = createPool({
    currentActive: false,
    finalPopulation: null,
    finalActive: false,
  });
  const repository = createOsmBoundaryAdminRepository(pool);

  const result = await repository.update(5, { population: null });

  assert.equal(result.population, null);
  assert.equal(result.active, false);
  const updateIndex = pool.queries.findIndex((query) =>
    /^UPDATE city_boundaries/i.test(query),
  );
  assert.equal(pool.parameters[updateIndex][4], null);
});

test('activating one OSM object never activates parents or descendants', async () => {
  const pool = createPool({
    currentActive: false,
    finalActive: true,
  });
  const repository = createOsmBoundaryAdminRepository(pool);

  await repository.update(5, { active: true });

  const updateIndex = pool.queries.findIndex((query) =>
    /^UPDATE city_boundaries/i.test(query),
  );
  assert.ok(updateIndex >= 0);
  assert.match(pool.queries[updateIndex], /WHERE id = $1$/i);
  assert.doesNotMatch(
    pool.queries[updateIndex],
    /parent_id|WITH RECURSIVE|ANY\\(/i,
  );
});

test('OSM subtree deactivation updates selected node and descendants once', async () => {
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

  assert.equal(result.affectedCount, 3);
  assert.equal(result.changedCount, 2);
  assert.ok(pool.queries.includes('SELECT sync_active_boundary_cities()'));
  assert.ok(
    pool.queries.includes('SELECT sync_active_boundary_populations()'),
  );
  assert.equal(pool.queries.at(-1), 'COMMIT');
});

test('OSM subtree activation validates boolean state before transaction', async () => {
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
