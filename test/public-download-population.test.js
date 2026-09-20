import assert from 'node:assert/strict';
import test from 'node:test';
import { createPublicDownloadRepository } from '../src/db/public-download-repository.js';

test('public CSV keeps cities without population but requires line geometries', async () => {
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
    /EXISTS \(\s*SELECT 1\s*FROM city_geometries AS geometry_presence\s*JOIN city_boundaries AS geometry_boundary\s*ON geometry_boundary\.id = geometry_presence\.boundary_id\s*AND geometry_boundary\.is_active\s*WHERE geometry_presence\.city_id = city\.id\s*\)/s,
  );
  assert.match(
    sql,
    /CASE WHEN city\.is_large IS TRUE THEN 'large' ELSE 'small' END AS category/,
  );
});
