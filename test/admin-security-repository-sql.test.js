import assert from 'node:assert/strict';
import test from 'node:test';
import { createAdminSecurityRepository } from '../src/db/admin-security-repository.js';

test('failed-login SQL avoids PostgreSQL CURRENT_USER keyword as a CTE name', async () => {
  let queryText = '';
  let queryValues = null;
  const database = {
    async query(text, values) {
      queryText = text;
      queryValues = values;
      return { rows: [] };
    },
  };
  const repository = createAdminSecurityRepository(database);
  const timestamp = '2026-09-07T20:00:00.000Z';

  await repository.recordFailedLogin(7, timestamp, {
    failureWindowSeconds: 900,
    maxFailedAttempts: 5,
    lockoutSeconds: 1800,
  });

  assert.match(queryText, /WITH\s+locked_user\s+AS\s*\(/i);
  assert.match(queryText, /FROM\s+locked_user\b/i);
  assert.doesNotMatch(queryText, /WITH\s+current_user\s+AS\s*\(/i);
  assert.deepEqual(queryValues, [7, timestamp, 900, 5, 1800]);
});
