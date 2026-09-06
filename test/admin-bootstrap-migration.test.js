import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const migrationPath = path.resolve(
  'db/migrations/V017__protect_bootstrap_admin.sql',
);

test('V017 marks exactly one bootstrap user and protects it at the database layer', async () => {
  const sql = await readFile(migrationPath, 'utf8');

  assert.match(sql, /ADD COLUMN IF NOT EXISTS IS_BOOTSTRAP BOOLEAN NOT NULL DEFAULT FALSE/i);
  assert.match(sql, /ADMIN_USERS_BOOTSTRAP_UIDX/i);
  assert.match(sql, /WHERE IS_BOOTSTRAP/i);
  assert.match(sql, /PROTECT_BOOTSTRAP_ADMIN_USER/i);
  assert.match(sql, /TG_OP = 'DELETE'/i);
  assert.match(sql, /NEW\.IS_BLOCKED/i);
  assert.match(sql, /NEW\.CAN_MANAGE_DATA/i);
  assert.match(sql, /NEW\.CAN_MANAGE_INTERFACE/i);
  assert.doesNotMatch(sql, /NEW\.LOCKED_UNTIL/i);
});
