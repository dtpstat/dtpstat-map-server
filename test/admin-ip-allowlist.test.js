import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeAdminNetwork,
} from '../src/modules/security/policy.js';
import {
  createAdminAccessControlRepository,
} from '../src/db/admin-access-control-repository.js';
import {
  createSecurityAdministrationService,
} from '../src/modules/security/admin-service.js';
import {
  createSecurityAuthService,
} from '../src/modules/security/auth-service.js';

test('admin IP allowlist accepts IPv4 IPv6 and CIDR but rejects invalid prefixes', () => {
  assert.equal(
    normalizeAdminNetwork(
      '192.168.1.10',
    ),
    '192.168.1.10/32',
  );
  assert.equal(
    normalizeAdminNetwork(
      '192.168.1.0/24',
    ),
    '192.168.1.0/24',
  );
  assert.equal(
    normalizeAdminNetwork(
      '2001:db8::/64',
    ),
    '2001:db8::/64',
  );

  assert.throws(
    () =>
      normalizeAdminNetwork(
        '192.168.0.0/99',
      ),
    /CIDR prefix is out of range/u,
  );
  assert.throws(
    () =>
      normalizeAdminNetwork(
        'not-an-ip',
      ),
    /valid IPv4 or IPv6/u,
  );
});

test('admin access-control allowlist uses typed PostgreSQL inet and cidr operators', async () => {
  const calls = [];
  const database = {
    async query(
      text,
      values = [],
    ) {
      calls.push({
        text:
          text.trim(),
        values,
      });

      if (
        text.includes(
          'INSERT INTO admin_ip_allowlist',
        )
      ) {
        return {
          rows: [{
            id: 3,
            network:
              '192.168.0.0/24',
          }],
          rowCount: 1,
        };
      }

      if (
        text.includes(
          'FROM admin_ip_allowlist',
        )
      ) {
        return {
          rows: [{
            id: 3,
            network:
              '192.168.0.0/24',
          }],
          rowCount: 1,
        };
      }

      return {
        rows: [],
        rowCount: 1,
      };
    },
  };

  const repository =
    createAdminAccessControlRepository(
      database,
    );

  await repository
    .findIpAllowlistMatch(
      '192.168.0.10',
    );
  await repository
    .createIpAllowlistEntry({
      network:
        '192.168.0.0/24',
      createdBy: 7,
      reason: 'LAN',
    });
  await repository
    .clearIpSecurityForNetwork(
      '192.168.0.0/24',
    );

  assert.match(
    calls[0].text,
    /\$1::inet <<= network/u,
  );
  assert.deepEqual(
    calls[0].values,
    ['192.168.0.10'],
  );
  assert.match(
    calls[1].text,
    /\$1::cidr/u,
  );
  assert.deepEqual(
    calls[1].values,
    [
      '192.168.0.0/24',
      7,
      'LAN',
    ],
  );
  assert.match(
    calls[2].text,
    /ip_address <<= \$1::cidr/u,
  );
  assert.match(
    calls[3].text,
    /ip_address <<= \$1::cidr/u,
  );
});

test('manual IP block rejects an address covered by the allowlist', async () => {
  const service =
    createSecurityAdministrationService(
      {
        async findIpAllowlistMatch() {
          return {
            id: 4,
            network:
              '10.0.0.0/8',
          };
        },
      },
    );

  await assert.rejects(
    service.createIpBlock(
      {
        ipAddress:
          '10.1.2.3',
        durationSeconds:
          3600,
      },
      {
        id: 7,
      },
      '192.0.2.10',
    ),
    /protected by the allowlist/u,
  );
});

test('authentication IP access treats allowlisted addresses as trusted before block state', async () => {
  let blockLookupCalled =
    false;

  const service =
    createSecurityAuthService(
      {
        async findIpAllowlistMatch(
          ipAddress,
        ) {
          assert.equal(
            ipAddress,
            '10.1.2.3',
          );
          return {
            id: 4,
            network:
              '10.0.0.0/8',
          };
        },
        async isIpBlocked() {
          blockLookupCalled =
            true;
          return {
            id: 8,
          };
        },
      },
      {
        async appendAudit() {},
      },
    );

  const state =
    await service.ipAccessState(
      '10.1.2.3',
    );

  assert.equal(
    state.status,
    'ok',
  );
  assert.equal(
    state.allowlisted,
    true,
  );
  assert.equal(
    blockLookupCalled,
    false,
  );
});
