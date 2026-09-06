import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_REPORT_CONFIG } from '../src/data/report-config.js';
import { createReportConfigService } from '../src/db/report-config-service.js';

function configRow() {
  const config = structuredClone(DEFAULT_REPORT_CONFIG);
  return {
    metrics: config.metrics,
    tableColumns: config.tableColumns,
    csvColumns: config.csvColumns,
    rankMetricKey: config.rank.metricKey,
    rankDirection: config.rank.direction,
    updatedAt: new Date('2026-09-06T00:00:00.000Z'),
  };
}

test('report materialization leaves rank null when ranking metric is missing', async () => {
  let rankingSql = '';
  const client = {
    async query(text) {
      if (/FROM report_config\s+WHERE id = 1/s.test(text)) {
        return { rows: [configRow()] };
      }
      if (/INSERT INTO city_report_values \(city_id, values, updated_at\)/.test(text)) {
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

  const result = await createReportConfigService(pool).refresh();

  assert.equal(result.cities, 2);
  assert.match(
    rankingSql,
    /WHEN report\.rank_value IS NULL THEN NULL/,
  );
  assert.match(
    rankingSql,
    /PARTITION BY COALESCE\(city\.is_large, FALSE\)/,
  );
});
