import assert from 'node:assert/strict';
import test from 'node:test';
import { createAdminAuditRepository } from '../src/db/admin-audit-repository.js';
import { createAdminUserRepository } from '../src/db/admin-user-repository.js';

test('failed-login SQL avoids PostgreSQL keyword and RETURNING ambiguities', async () => {
  let queryText = '';
  let queryValues = null;
  const database = {
    async query(text, values) {
      queryText = text;
      queryValues = values;
      return { rows: [] };
    },
  };
  const repository = createAdminUserRepository(database);
  const timestamp = '2026-09-07T20:00:00.000Z';

  await repository.recordFailedLogin(7, timestamp, {
    failureWindowSeconds: 900,
    maxFailedAttempts: 5,
    lockoutSeconds: 1800,
  });

  assert.match(queryText, /WITH\s+locked_user\s+AS\s*\(/i);
  assert.match(queryText, /FROM\s+locked_user\b/i);
  assert.doesNotMatch(queryText, /WITH\s+current_user\s+AS\s*\(/i);
  assert.match(queryText, /SELECT\s+id\s+AS\s+user_id\s*,/i);
  assert.match(queryText, /WHERE\s+users\.id\s*=\s*next_state\.user_id/i);
  assert.doesNotMatch(queryText, /WHERE\s+users\.id\s*=\s*next_state\.id/i);
  assert.match(
    queryText,
    /RETURNING\s+users\.failed_login_count\s+AS\s+"failedLoginCount"\s*,\s*users\.locked_until\s+AS\s+"lockedUntil"/i,
  );
  assert.doesNotMatch(queryText, /RETURNING\s+id\b/i);
  assert.deepEqual(queryValues, [7, timestamp, 900, 5, 1800]);
});


test('audit listing exposes avatar availability without changing historical username', async () => {
  let queryText = '';
  const database = {
    async query(text) {
      queryText = text;
      return {
        rows: [{
          id: 9,
          username: 'operator',
          userId: 7,
          hasAvatar: true,
          details: {},
        }],
      };
    },
  };
  const repository = createAdminAuditRepository(database);

  const rows = await repository.listAudit({ limit: 10, offset: 0 });

  assert.equal(rows[0].hasAvatar, true);
  assert.equal(rows[0].username, 'operator');
  assert.match(
    queryText,
    /SELECT\s+admin_user\.avatar_data IS NOT NULL[\s\S]*FROM admin_users AS admin_user[\s\S]*admin_user\.id = admin_audit_log\.user_id/s,
  );
  assert.match(queryText, /AS "hasAvatar"/);
});
