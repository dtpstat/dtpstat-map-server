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

test('admin realtime client owns the single websocket connection and mutation client id', async () => {
  const [client, admin, shell] =
    await Promise.all([
      fs.readFile(
        path.join(
          root,
          'admin/realtime-client.js',
        ),
        'utf8',
      ),
      fs.readFile(
        path.join(
          root,
          'admin/admin.js',
        ),
        'utf8',
      ),
      fs.readFile(
        path.join(
          root,
          'admin/admin-shell.js',
        ),
        'utf8',
      ),
    ]);

  assert.match(
    client,
    /new WebSocket\(/u,
  );
  assert.match(
    client,
    /X-DTPStat-Realtime-Client/u,
  );
  assert.match(
    client,
    /type ===[\s\S]*'data-change'/u,
  );
  assert.match(
    client,
    /dtpstatAdminFeedback/u,
  );
  assert.doesNotMatch(
    admin,
    /new WebSocket\(/u,
  );
  assert.match(
    admin,
    /subscribeAdminRealtime/u,
  );
  assert.match(
    shell,
    /startAdminRealtime/u,
  );
});
