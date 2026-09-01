import assert from 'node:assert/strict';
import test from 'node:test';
import { createCitiesRepository } from '../src/db/cities-repository.js';

test('city list qualifies ID after joining OSM boundaries', async () => {
  let sql;
  const repository = createCitiesRepository({
    async query(text) {
      sql = text;
      return { rows: [] };
    },
  });

  await repository.listCities();

  assert.match(sql, /city\.id::integer AS id/);
  assert.doesNotMatch(sql, /\n\s+id::integer AS id/);
});
