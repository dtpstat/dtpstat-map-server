import assert from 'node:assert/strict';
import test from 'node:test';
import { createPublicDownloadRepository } from '../src/db/public-download-repository.js';

test('public CSV keeps cities without population but requires effective project geometries', async () => {
  let sql = '';
  const repository = createPublicDownloadRepository({
    async query(text) {
      sql = text;
      return { rows: [] };
    },
  });

  await repository.exportCsvRows();

  assert.match(sql, /FROM cities AS city/);
  assert.match(sql, /JOIN city_boundaries AS boundary\s+ON boundary\.city_id = city\.id\s+AND boundary\.is_active/s);
  assert.doesNotMatch(sql, /JOIN city_populations AS population/);
  assert.match(
    sql,
    /EXISTS \(\s*SELECT 1\s*FROM effective_city_geometries AS geometry_presence\s*WHERE geometry_presence\.city_id = city\.id\s*\)/s,
  );
  assert.match(
    sql,
    /CASE WHEN city\.is_large IS TRUE THEN 'large' ELSE 'small' END AS category/,
  );
});
