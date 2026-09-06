import assert from 'node:assert/strict';
import test from 'node:test';
import { createPublicDownloadRepository } from '../src/db/public-download-repository.js';

test('public CSV city query does not require a population row', async () => {
  let sql = '';
  const repository = createPublicDownloadRepository({
    async query(text) {
      sql = text;
      return { rows: [] };
    },
  });

  await repository.exportCsvRows();

  assert.match(sql, /FROM cities AS city/);
  assert.match(sql, /JOIN city_boundaries AS boundary ON boundary\.city_id = city\.id/);
  assert.doesNotMatch(sql, /JOIN city_populations AS population/);
  assert.match(
    sql,
    /CASE WHEN city\.is_large IS TRUE THEN 'large' ELSE 'small' END AS category/,
  );
});
