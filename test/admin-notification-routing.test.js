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

async function read(file) {
  return fs.readFile(
    path.join(root, file),
    'utf8',
  );
}

test('notification infrastructure stays domain-owned and explicitly wired through application composition', async () => {
  const [
    channel,
    runtime,
    server,
    app,
    api,
    router,
  ] = await Promise.all([
    read('src/modules/notifications/channel.js'),
    read('src/application/admin-runtime.js'),
    read('src/server.js'),
    read('src/app.js'),
    read('src/application/http/api-composition.js'),
    read('src/routes/admin-security-api.js'),
  ]);

  assert.match(
    channel,
    /createAdminNotificationChannel/u,
  );
  assert.doesNotMatch(
    channel,
    /src\/(?:application|db|routes|http)/u,
  );
  assert.match(
    runtime,
    /modules\/notifications\/channel\.js/u,
  );
  assert.match(
    runtime,
    /notificationEvents/u,
  );
  assert.match(
    server,
    /adminRuntime\.notificationEvents/u,
  );
  assert.match(
    app,
    /notificationEvents/u,
  );
  assert.match(
    api,
    /notificationEvents/u,
  );
  assert.match(
    router,
    /notificationEvents/u,
  );
});

test('security mutations publish targeted session refresh and logout controls', async () => {
  const [
    users,
    profile,
    websocket,
    auth,
  ] = await Promise.all([
    read('src/routes/security/user-routes.js'),
    read('src/routes/security/profile-routes.js'),
    read('src/http/admin-websocket.js'),
    read('src/modules/security/auth-service.js'),
  ]);

  assert.match(
    users,
    /refresh-session/u,
  );
  assert.match(
    users,
    /admin-user-(?:deleted|blocked)/u,
  );
  assert.match(
    profile,
    /other-sessions-revoked/u,
  );
  assert.match(
    profile,
    /session-revoked/u,
  );
  assert.match(
    websocket,
    /authenticateRealtime/u,
  );
  assert.match(
    websocket,
    /session-control/u,
  );
  assert.match(
    auth,
    /touchActivity:\s*false/u,
  );
});


test('editing another administrator notifies both the target session and the operator', async () => {
  const users =
    await read(
      'src/routes/security/user-routes.js',
    );

  assert.match(
    users,
    /audience:\s*\{\s*userIds: \[user\.id\]/u,
  );
  assert.match(
    users,
    /Number\(\s*request\.adminUser\?\.id[\s\S]*Number\(user\.id\)[\s\S]*Пользователь [\s\S]*изменения применены/u,
  );
  assert.match(
    users,
    /permission: 'users'[\s\S]*request\.adminUser\.id/u,
  );
});
