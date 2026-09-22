import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createOsmBoundaryAdminRepository,
  OsmBoundaryAdminValidationError,
} from '../src/db/osm-boundary-admin-repository.js';

function createPool({
  currentActive = true,
  currentPopulation = 120000,
  currentPopulationAsOf = '2026-01-01',
  currentPopulationSource = 'test',
  currentAttributes = { note: 'x' },
  finalPopulation = currentPopulation,
  finalPopulationAsOf = currentPopulationAsOf,
  finalPopulationSource = currentPopulationSource,
  finalAttributes = currentAttributes,
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
    populationAsOf: finalPopulationAsOf,
    populationSource: finalPopulationSource,
    attributes: finalAttributes,
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
            populationAsOf: currentPopulationAsOf,
            populationSource: currentPopulationSource,
            attributes: currentAttributes,
          }],
          rowCount: 1,
        };
      }

      if (
        normalized.startsWith('SELECT') &&
        normalized.includes('boundary.id::integer AS id') &&
        normalized.includes('boundary.population::integer AS population')
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

test('territory data can be edited on an inactive OSM boundary without activating it', async () => {
  const pool = createPool({
    currentActive: false,
    currentPopulation: null,
    finalPopulation: 125000,
    finalPopulationAsOf: '2026-02-01',
    finalPopulationSource: 'Регионстат',
    finalAttributes: { census: true },
    finalActive: false,
  });
  const repository = createOsmBoundaryAdminRepository(pool);

  const result = await repository.update(5, {
    population: 125000,
    populationAsOf: '2026-02-01',
    populationSource: 'Регионстат',
    attributes: { census: true },
  });

  assert.equal(result.population, 125000);
  assert.equal(result.populationAsOf, '2026-02-01');
  assert.equal(result.populationSource, 'Регионстат');
  assert.deepEqual(result.attributes, { census: true });
  assert.equal(result.active, false);

  const updateIndex = pool.queries.findIndex((query) =>
    /^UPDATE city_boundaries/i.test(query),
  );
  assert.ok(updateIndex >= 0);
  assert.equal(pool.parameters[updateIndex][1], false);
  assert.equal(pool.parameters[updateIndex][4], 125000);
  assert.equal(pool.parameters[updateIndex][5], '2026-02-01');
  assert.equal(pool.parameters[updateIndex][6], 'Регионстат');
  assert.equal(pool.parameters[updateIndex][7], '{"census":true}');
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
  assert.ok(pool.queries[updateIndex].endsWith('WHERE id = $1'));
  assert.equal(pool.queries[updateIndex].includes('parent_id'), false);
  assert.equal(pool.queries[updateIndex].includes('WITH RECURSIVE'), false);
  assert.equal(pool.queries[updateIndex].includes('ANY('), false);
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
