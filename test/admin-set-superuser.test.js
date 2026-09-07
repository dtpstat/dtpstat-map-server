import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveSuperuserCredentials,
  setSuperuserCredentials,
} from '../scripts/set-superuser-credentials.js';

test('superuser credential task defaults to bootstrap credentials from env', () => {
  assert.deepEqual(
    resolveSuperuserCredentials([], {
      IMPORT_API_USERNAME: ' admin1 ',
      IMPORT_API_PASSWORD: 'secret',
    }),
    {
      help: false,
      username: 'admin1',
      password: 'secret',
    },
  );
});

test('superuser credential task updates the only superuser and revokes sessions', async () => {
  const calls = [];
  const database = {
    async query(text, values) {
      calls.push({ text, values });
      if (/SELECT[\s\S]+FROM admin_users[\s\S]+is_superuser = TRUE/i.test(text)) {
        return { rows: [{ id: 7, username: 'old-admin' }] };
      }
      if (/UPDATE admin_users/i.test(text)) {
        return { rows: [{ id: 7, username: 'admin1' }] };
      }
      if (/DELETE FROM admin_sessions/i.test(text)) {
        return { rows: [], rowCount: 3 };
      }
      throw new Error(`Unexpected query: ${text}`);
    },
  };

  const result = await setSuperuserCredentials(database, {
    username: 'admin1',
    passwordHash: 'hash',
  });

  assert.deepEqual(result, {
    id: 7,
    previousUsername: 'old-admin',
    username: 'admin1',
    revokedSessions: 3,
  });
  assert.match(calls[1].text, /password_hash = \$3/i);
  assert.match(calls[1].text, /is_blocked = FALSE/i);
  assert.match(calls[1].text, /failed_login_count = 0/i);
  assert.match(calls[1].text, /can_manage_security = TRUE/i);
  assert.deepEqual(calls[1].values, [7, 'admin1', 'hash']);
  assert.deepEqual(calls[2].values, [7]);
});

test('superuser credential task refuses ambiguous superuser state', async () => {
  const database = {
    async query() {
      return {
        rows: [
          { id: 1, username: 'one' },
          { id: 2, username: 'two' },
        ],
      };
    },
  };

  await assert.rejects(
    () => setSuperuserCredentials(database, {
      username: 'admin1',
      passwordHash: 'hash',
    }),
    /Expected exactly one superuser, found 2/,
  );
});
