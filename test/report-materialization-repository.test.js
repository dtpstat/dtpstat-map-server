import assert from 'node:assert/strict';
import test from 'node:test';
import {
  materializeReportValues,
} from '../src/db/report-materialization-repository.js';

function createClient() {
  const queries = [];
  return {
    queries,
    async query(text, values = []) {
      const normalized = text.trim();
      queries.push({ text: normalized, values });
      if (normalized.startsWith('INSERT INTO city_report_values')) {
        return {
          rows: [{ city_id: 1 }, { city_id: 2 }],
          rowCount: 2,
        };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

test('shared report materializer rebuilds metrics and sequential ranking', async () => {
  const client = createClient();
  const config = {
    metrics: [{
      key: 'population',
      name: 'Population',
      source: {
        kind: 'field',
        field: 'city.population',
      },
      operations: [],
    }],
    rank: {
      sort: [{
        metricKey: 'population',
        direction: 'desc',
      }],
    },
  };

  const result = await materializeReportValues(client, config);

  assert.equal(result.cities, 2);
  assert.equal(result.metrics, 1);
  assert.equal(result.rankMetricKey, 'population');
  assert.equal(result.rankDirection, 'desc');
  assert.deepEqual(result.rankSort, config.rank.sort);

  assert.equal(
    client.queries[0].text,
    'DELETE FROM city_report_values',
  );
  assert.match(
    client.queries[1].text,
    /^INSERT INTO city_report_values/u,
  );
  assert.match(client.queries[2].text, /^WITH metric_values AS/u);
  assert.match(
    client.queries[3].text,
    /^UPDATE city_report_values/u,
  );
  assert.deepEqual(client.queries[3].values, ['population']);
  assert.match(client.queries[4].text, /^WITH ranked AS/u);
});

test('shared report materializer includes only active-boundary line cities', async () => {
  const client = createClient();
  const config = {
    metrics: [{
      key: 'population',
      name: 'Population',
      source: {
        kind: 'field',
        field: 'city.population',
      },
      operations: [],
    }],
    rank: {
      sort: [{
        metricKey: 'population',
        direction: 'desc',
      }],
    },
  };

  await materializeReportValues(client, config);

  const seed = client.queries[1].text;
  assert.match(seed, /boundary_presence\.is_active/u);
  assert.match(seed, /geometry_boundary\.is_active/u);
  assert.match(
    seed,
    /geometry_presence\.city_id = city\.id/u,
  );
});
