import assert from 'node:assert/strict';
import test from 'node:test';
import { createLineTypesRepository } from '../src/db/line-types-repository.js';

test('line type geometry counts include only active boundary geometries', async () => {
  let sql = '';
  const repository = createLineTypesRepository({
    async query(text) {
      sql = text;
      return {
        rows: [{
          id: 1,
          code: 1,
          name: 'default',
          title: 'Линии',
          color: '#000000',
          style: 'solid',
          width: 3,
          geometryCount: 2,
        }],
      };
    },
  });

  const rows = await repository.list();

  assert.equal(rows[0].geometryCount, 2);
  assert.match(
    sql,
    /LEFT JOIN city_boundaries AS active_boundary\s+ON active_boundary\.id = geometry\.boundary_id\s+AND active_boundary\.is_active/s,
  );
  assert.match(
    sql,
    /count\(geometry\.id\) FILTER \(\s*WHERE active_boundary\.id IS NOT NULL\s*\)::integer AS "geometryCount"/s,
  );
});
