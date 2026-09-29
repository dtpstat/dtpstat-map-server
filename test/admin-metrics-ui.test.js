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


test('Prometheus controls are top-level and use a compact checkbox', async () => {
  const [
    editor,
    css,
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
          'admin/security-v2.css',
        ),
        'utf8',
      ),
    ]);

  const metricsIndex =
    editor.indexOf(
      'class="security-metrics-panel"',
    );
  const advancedIndex =
    editor.indexOf(
      'class="admin-advanced-settings"',
    );

  assert.ok(
    metricsIndex >= 0,
  );
  assert.ok(
    advancedIndex >= 0,
  );
  assert.ok(
    metricsIndex <
      advancedIndex,
    'Prometheus controls must remain outside the advanced-settings disclosure',
  );
  assert.match(
    editor,
    /class="security-metrics-toggle"/u,
  );
  assert.match(
    css,
    /\.security-settings-form \.security-metrics-toggle input\[type="checkbox"\][\s\S]*width:\s*1rem;[\s\S]*height:\s*1rem;/u,
  );
});
