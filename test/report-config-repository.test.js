import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createReportConfigRepository,
} from '../src/db/report-config-repository.js';

function createQueryable() {
  const queries = [];
  return {
    queries,
    async query(text, values = []) {
      const normalized = text.trim();
      queries.push({ text: normalized, values });

      if (normalized.startsWith('SELECT') &&
          normalized.includes('jsonb_object_agg(config_key, config_value)')) {
        return {
          rows: [{
            config: {
              metrics: [],
              table_columns: [],
              csv_columns: [],
              rank: { sort: [] },
            },
            updatedAt: '2026-09-23T12:00:00.000Z',
          }],
          rowCount: 1,
        };
      }
      if (normalized === 'SELECT name FROM line_types ORDER BY id') {
        return {
          rows: [{ name: 'default' }, { name: 'tram' }],
          rowCount: 2,
        };
      }
      if (normalized.startsWith('WITH saved AS')) {
        return {
          rows: [{ updatedAt: '2026-09-23T13:00:00.000Z' }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

test('report config repository loads vertical config and line type catalog', async () => {
  const repository = createReportConfigRepository();
  const queryable = createQueryable();

  const row = await repository.load(queryable);
  const names = await repository.lineTypeNames(queryable);

  assert.deepEqual(row.config.rank, { sort: [] });
  assert.deepEqual(names, ['default', 'tram']);
  assert.match(
    queryable.queries[0].text,
    /jsonb_object_agg\(config_key, config_value\)/u,
  );
  assert.equal(
    queryable.queries[1].text,
    'SELECT name FROM line_types ORDER BY id',
  );
});

test('report config repository saves four vertical config keys atomically', async () => {
  const repository = createReportConfigRepository();
  const queryable = createQueryable();
  const updatedAt = await repository.save(queryable, {
    metrics: [{ key: 'population' }],
    tableColumns: [{ kind: 'city' }],
    csvColumns: [{ kind: 'city' }],
    rank: {
      sort: [{ metricKey: 'population', direction: 'desc' }],
    },
  });

  assert.equal(updatedAt, '2026-09-23T13:00:00.000Z');
  assert.match(queryable.queries[0].text, /^WITH saved AS/u);
  assert.match(
    queryable.queries[0].text,
    /ON CONFLICT \(config_key\)/u,
  );
  assert.deepEqual(
    JSON.parse(queryable.queries[0].values[3]),
    {
      sort: [{ metricKey: 'population', direction: 'desc' }],
    },
  );
});
