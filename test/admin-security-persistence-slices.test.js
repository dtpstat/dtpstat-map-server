import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createAdminAccessControlRepository,
} from '../src/db/admin-access-control-repository.js';
import {
  createAdminAuditRepository,
} from '../src/db/admin-audit-repository.js';
import {
  createAdminSessionRepository,
} from '../src/db/admin-session-repository.js';
import {
  createAdminUserRepository,
} from '../src/db/admin-user-repository.js';

test('admin user repository owns account permissions login state and avatar SQL', async () => {
  const calls = [];
  const database = {
    async query(text, values = []) {
      const normalized = text.trim();
      calls.push({ text: normalized, values });
      return {
        rows: normalized.includes('RETURNING')
          ? [{ id: 7, canEditOsm: true }]
          : [],
        rowCount: 1,
      };
    },
  };
  const repository = createAdminUserRepository(database);

  await repository.updateUser(7, {
    displayName: 'Operator',
    email: null,
    canManageData: true,
    canManageInterface: true,
    canEditOsm: true,
    canManageUsers: false,
    canViewAudit: true,
    canManageSecurity: false,
    isBlocked: false,
  });
  await repository.recordFailedLogin(
    7,
    '2026-09-24T10:00:00.000Z',
    {
      failureWindowSeconds: 900,
      maxFailedAttempts: 5,
      lockoutSeconds: 1800,
    },
  );
  await repository.saveAvatar(
    7,
    'image/png',
    Buffer.from([1, 2, 3]),
  );

  assert.match(calls[0].text, /can_edit_osm = \$6/u);
  assert.match(calls[1].text, /^WITH locked_user AS/u);
  assert.match(
    calls[1].text,
    /WHERE users\.id = next_state\.user_id/u,
  );
  assert.match(calls[2].text, /avatar_data=\$3/u);
});

test('admin session repository owns session lifecycle SQL', async () => {
  const calls = [];
  const database = {
    async query(text, values = []) {
      const normalized = text.trim();
      calls.push({ text: normalized, values });
      if (normalized.startsWith('INSERT INTO admin_sessions')) {
        return { rows: [{ id: 11 }], rowCount: 1 };
      }
      if (normalized.startsWith('DELETE FROM admin_sessions')) {
        return { rows: [{ id: 11 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  const repository = createAdminSessionRepository(database);

  const created = await repository.createSession({
    userId: 7,
    tokenHash: 'hash',
    expiresAt: '2026-09-24T12:00:00.000Z',
    ipAddress: '127.0.0.1',
    userAgent: 'test',
  });
  const revoked = await repository.revokeSessionById(7, 11);

  assert.equal(created.id, 11);
  assert.equal(revoked, true);
  assert.match(calls[0].text, /^INSERT INTO admin_sessions/u);
  assert.match(
    calls[0].text,
    /ip_address,user_agent/u,
  );
  assert.match(
    calls[1].text,
    /^DELETE FROM admin_sessions/u,
  );
});

test('admin access-control repository keeps settings IP failure and manual block storage together', async () => {
  const calls = [];
  const database = {
    async query(text, values = []) {
      const normalized = text.trim();
      calls.push({ text: normalized, values });
      if (normalized.includes('FROM admin_security_settings')) {
        return {
          rows: [{
            maxFailedAttempts: 5,
            ipMaxFailedAttempts: 20,
          }],
          rowCount: 1,
        };
      }
      if (normalized.startsWith('INSERT INTO admin_login_ip_state')) {
        return {
          rows: [{
            ipAddress: '127.0.0.1',
            failedLoginCount: 1,
          }],
          rowCount: 1,
        };
      }
      if (normalized.startsWith('INSERT INTO admin_blocked_ips')) {
        return {
          rows: [{ id: 3, ipAddress: '10.0.0.1' }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  const repository =
    createAdminAccessControlRepository(database);

  const settings = await repository.getSecuritySettings();
  const failed = await repository.recordFailedIp(
    '127.0.0.1',
    '2026-09-24T10:00:00.000Z',
    {
      ipFailureWindowSeconds: 900,
      ipMaxFailedAttempts: 20,
      ipLockoutSeconds: 3600,
    },
  );
  const block = await repository.createIpBlock({
    ipAddress: '10.0.0.1',
    expiresAt: null,
    blockedBy: 7,
    reason: 'test',
    sourceAuditId: null,
  });

  assert.equal(settings.maxFailedAttempts, 5);
  assert.equal(failed.failedLoginCount, 1);
  assert.equal(block.id, 3);
  assert.match(
    calls[0].text,
    /FROM admin_security_settings/u,
  );
  assert.match(
    calls[1].text,
    /^INSERT INTO admin_login_ip_state/u,
  );
  assert.match(
    calls[2].text,
    /^INSERT INTO admin_blocked_ips/u,
  );
});

test('admin audit repository parameterizes filters and exposes avatar availability', async () => {
  let queryText = '';
  let queryValues = [];
  const database = {
    async query(text, values = []) {
      queryText = text.trim();
      queryValues = values;
      return {
        rows: [{
          id: 9,
          username: 'operator',
          hasAvatar: true,
        }],
      };
    },
  };
  const repository = createAdminAuditRepository(database);

  const rows = await repository.listAudit({
    eventType: 'authentication',
    username: 'operator',
    limit: 10,
    offset: 20,
  });

  assert.equal(rows[0].hasAvatar, true);
  assert.match(
    queryText,
    /event_type = \$1/u,
  );
  assert.match(
    queryText,
    /LOWER\(username\) = LOWER\(\$2\)/u,
  );
  assert.match(
    queryText,
    /admin_user\.avatar_data IS NOT NULL/u,
  );
  assert.deepEqual(
    queryValues,
    ['authentication', 'operator', 10, 20],
  );
});
