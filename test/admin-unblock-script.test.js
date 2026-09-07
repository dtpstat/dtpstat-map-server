import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseAdminUnblockArgs,
  unblockAdminTargets,
} from '../scripts/unblock-admin.js';

test('admin unblock arguments accept user and IP targets', () => {
  assert.deepEqual(
    parseAdminUnblockArgs(['--user', 'admin1', '--ip', '95.85.188.59']),
    {
      help: false,
      username: 'admin1',
      ipAddress: '95.85.188.59',
    },
  );
  assert.throws(
    () => parseAdminUnblockArgs([]),
    /Specify --user, --ip, or both/,
  );
  assert.throws(
    () => parseAdminUnblockArgs(['--ip', 'not-an-ip']),
    /Invalid IP address/,
  );
});

test('admin unblock clears automatic and manual account/IP blocks', async () => {
  const calls = [];
  const database = {
    async query(text, values) {
      calls.push({ text, values });
      if (text.includes('UPDATE admin_users')) {
        return {
          rows: [{ id: 7, username: 'admin1' }],
          rowCount: 1,
        };
      }
      if (text.includes('DELETE FROM admin_login_ip_state')) {
        return {
          rows: [{ ipAddress: '95.85.188.59' }],
          rowCount: 1,
        };
      }
      if (text.includes('DELETE FROM admin_blocked_ips')) {
        return {
          rows: [{ id: 3 }, { id: 4 }],
          rowCount: 2,
        };
      }
      throw new Error('Unexpected query');
    },
  };

  const result = await unblockAdminTargets(database, {
    username: 'admin1',
    ipAddress: '95.85.188.59',
  });

  assert.deepEqual(result, {
    user: { id: 7, username: 'admin1' },
    ip: {
      ipAddress: '95.85.188.59',
      automaticStateCleared: true,
      manualBlocksCleared: 2,
    },
  });

  const userSql = calls.find((call) => call.text.includes('UPDATE admin_users')).text;
  assert.match(userSql, /is_blocked = FALSE/);
  assert.match(userSql, /failed_login_count = 0/);
  assert.match(userSql, /locked_until = NULL/);
  assert.match(userSql, /manual_blocked_at = NULL/);
  assert.ok(calls.some((call) => call.text.includes('DELETE FROM admin_login_ip_state')));
  assert.ok(calls.some((call) => call.text.includes('DELETE FROM admin_blocked_ips')));
});
