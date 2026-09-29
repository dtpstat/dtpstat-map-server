import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  fileURLToPath,
} from 'node:url';

const root =
  path.resolve(
    path.dirname(
      fileURLToPath(
        import.meta.url,
      ),
    ),
    '..',
  );

test('operations monitoring templates track the application observability contract', async () => {
  const [
    filter,
    jail,
    rules,
    docs,
  ] =
    await Promise.all([
      fs.readFile(
        path.join(
          root,
          'ops/fail2ban/filter.d/dtpstat-admin-lockout.conf',
        ),
        'utf8',
      ),
      fs.readFile(
        path.join(
          root,
          'ops/fail2ban/jail.d/dtpstat-admin.local.example',
        ),
        'utf8',
      ),
      fs.readFile(
        path.join(
          root,
          'ops/prometheus/dtpstat-alerts.yml',
        ),
        'utf8',
      ),
      fs.readFile(
        path.join(
          root,
          'docs/monitoring.md',
        ),
        'utf8',
      ),
    ]);

  assert.match(
    filter,
    /DTPSTAT_SECURITY_V1/u,
  );
  assert.match(
    filter,
    /admin\\\.auth\\\.ip_lockout/u,
  );
  assert.match(
    filter,
    /admin\\\.request\\\.ip_lockout/u,
  );
  assert.match(
    filter,
    /"ip":"<HOST>"/u,
  );
  assert.doesNotMatch(
    filter,
    /admin\\\.auth\\\.failed/u,
  );

  assert.match(
    jail,
    /backend = systemd/u,
  );
  assert.match(
    jail,
    /maxretry = 1/u,
  );
  assert.match(
    jail,
    /journalmatch = _SYSTEMD_UNIT=dtpstat\.service/u,
  );

  for (
    const metric of
    [
      'dtpstat_http_requests_total',
      'dtpstat_http_request_duration_seconds_bucket',
      'dtpstat_db_pool_connections',
      'dtpstat_db_pool_max_connections',
    ]
  ) {
    assert.match(
      rules,
      new RegExp(
        metric,
        'u',
      ),
    );
  }

  assert.match(
    rules,
    /route=~"\/api\/admin\/login\(\?:\/mfa\)\?"/u,
  );
  assert.match(
    docs,
    /promtool check rules/u,
  );
  assert.match(
    docs,
    /fail2ban-regex/u,
  );
});
