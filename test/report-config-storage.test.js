import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (relativePath) => fs.readFile(path.join(root, relativePath), 'utf8');

test('V033 migrates the report singleton into vertical key-value rows', async () => {
  const migration = await source('db/migrations/V033__vertical_report_config.sql');

  assert.match(migration, /CONFIG_KEY\s+TEXT PRIMARY KEY/i);
  assert.match(migration, /CONFIG_VALUE\s+JSONB\s+NOT NULL/i);
  for (const key of ['metrics', 'table_columns', 'csv_columns', 'rank']) {
    assert.match(migration, new RegExp(`'${key}'`));
  }
  assert.match(migration, /JSONB_BUILD_OBJECT\(\s*'sort'/i);
  assert.match(migration, /DROP TABLE BUSLANES\.REPORT_CONFIG/i);
  assert.match(migration, /RENAME TO REPORT_CONFIG/i);
});

test('runtime report storage uses config keys instead of widening the table', async () => {
  const [service, transferRepository, downloads] = await Promise.all([
    source('src/db/report-config-service.js'),
    source('src/db/project-settings-transfer-repository.js'),
    source('src/db/public-download-repository.js'),
  ]);

  assert.match(service, /jsonb_object_agg\(config_key, config_value\)/i);
  assert.match(service, /ON CONFLICT \(config_key\)/i);
  assert.match(service, /'rank', \$4::jsonb/i);
  assert.doesNotMatch(service, /rank_metric_key|rank_direction|WHERE id = 1/i);

  assert.match(transferRepository, /jsonb_object_agg\(config_key, config_value\)/i);
  assert.match(transferRepository, /ON CONFLICT\(config_key\)/i);
  assert.doesNotMatch(transferRepository, /rank_metric_key|rank_direction/i);

  assert.match(downloads, /config_key = 'csv_columns'/i);
  assert.match(downloads, /config_value AS "csvColumns"/i);
});
