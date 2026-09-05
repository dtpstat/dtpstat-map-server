import assert from 'node:assert/strict';
import test from 'node:test';
import { acquireDataImportLock } from '../src/db/database-locks.js';

test('data import advisory lock is scoped by database schema', async () => {
  const calls = [];
  const client = {
    async query(text, values) {
      calls.push({ text: text.trim(), values });
      return { rows: [] };
    },
  };

  await acquireDataImportLock(client, { databaseSchema: 'tramlanes' });

  assert.deepEqual(calls, [
    {
      text: 'SELECT pg_advisory_xact_lock(hashtext($1))',
      values: ['tramlanes:data-import'],
    },
  ]);
});

test('data import advisory lock keeps buslanes as the legacy default', async () => {
  const calls = [];
  await acquireDataImportLock(
    {
      async query(text, values) {
        calls.push({ text: text.trim(), values });
        return { rows: [] };
      },
    },
    {},
  );

  assert.deepEqual(calls[0].values, ['buslanes:data-import']);
});
