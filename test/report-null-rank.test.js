import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_REPORT_CONFIG } from '../src/modules/reporting/config-policy.js';
import { createReportConfigRuntime } from '../src/application/project-report-runtime.js';

function configRow() {
  const config = structuredClone(DEFAULT_REPORT_CONFIG);
  return {
    config: {
      metrics: config.metrics,
      table_columns: config.tableColumns,
      csv_columns: config.csvColumns,
      rank: config.rank,
    },
    updatedAt: new Date('2026-09-06T00:00:00.000Z'),
  };
}

test('report materialization ranks only visible cities and leaves missing metric rank null', async () => {
  let materializeSql = '';
  let rankingSql = '';
  const client = {
    async query(text) {
      if (/FROM report_config/.test(text)) {
        return { rows: [configRow()] };
      }
      if (/INSERT INTO city_report_values \(city_id, values, updated_at\)/.test(text)) {
        materializeSql = text;
        return { rows: [{ city_id: 1 }, { city_id: 2 }] };
      }
      if (/WITH ranked AS/.test(text)) rankingSql = text;
      return { rows: [] };
    },
    release() {},
  };
  const pool = {
    databaseSchema: 'buslanes',
    async connect() { return client; },
  };

  const result = await createReportConfigRuntime(pool).refresh();

  assert.equal(result.cities, 2);
  assert.match(
    materializeSql,
    /FROM city_boundaries AS boundary_presence\s*WHERE boundary_presence\.city_id = city\.id\s*AND boundary_presence\.is_active/s,
  );
  assert.match(
    materializeSql,
    /FROM city_geometries AS geometry_presence\s*JOIN city_boundaries AS geometry_boundary\s*ON geometry_boundary\.id = geometry_presence\.boundary_id\s*AND geometry_boundary\.is_active\s*WHERE geometry_presence\.city_id = city\.id/s,
  );
  assert.match(
    rankingSql,
    /WHEN report\.rank_value IS NULL THEN NULL/,
  );
  assert.match(
    rankingSql,
    /PARTITION BY COALESCE\(city\.is_large, FALSE\)/,
  );
});
