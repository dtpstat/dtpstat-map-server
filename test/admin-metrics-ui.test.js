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

test('security admin manages Prometheus access without exposing stored plaintext', async () => {
  const [
    editor,
    routes,
    migration,
  ] =
    await Promise.all([
      fs.readFile(
        path.join(
          root,
          'admin/security-editor-v2.js',
        ),
        'utf8',
      ),
      fs.readFile(
        path.join(
          root,
          'src/routes/security/control-routes.js',
        ),
        'utf8',
      ),
      fs.readFile(
        path.join(
          root,
          'db/migrations/V054__admin_metrics_settings.sql',
        ),
        'utf8',
      ),
    ]);

  assert.match(
    editor,
    /name="metricsEnabled"/u,
  );
  assert.match(
    editor,
    /security-metrics-token-rotate/u,
  );
  assert.match(
    editor,
    /security-metrics-token-clear/u,
  );
  assert.match(
    editor,
    /showMetricsBearerToken/u,
  );
  assert.match(
    routes,
    /\/admin\/security\/metrics-token/u,
  );
  assert.match(
    routes,
    /security\.metrics-token\.rotate/u,
  );
  assert.match(
    routes,
    /security\.metrics-token\.clear/u,
  );
  assert.match(
    migration,
    /METRICS_BEARER_TOKEN_HASH BYTEA/u,
  );
  assert.doesNotMatch(
    migration,
    /METRICS_BEARER_TOKEN\s+TEXT/u,
  );
});
