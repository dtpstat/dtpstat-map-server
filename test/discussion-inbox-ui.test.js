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

function read(
  relativePath,
) {
  return fs.readFile(
    path.join(
      root,
      relativePath,
    ),
    'utf8',
  );
}

test('profile discussion inbox unifies geometry and OSM threads with realtime unread state', async () => {
  const [
    shell,
    inbox,
    styles,
    geometry,
    osm,
  ] =
    await Promise.all([
      read(
        'admin/admin-shell.js',
      ),
      read(
        'admin/discussion-inbox.js',
      ),
      read(
        'admin/discussion-inbox.css',
      ),
      read(
        'admin/geometry-editor.js',
      ),
      read(
        'admin/osm-boundary-editor.js',
      ),
    ]);

  assert.match(
    shell,
    /import\('\.\/discussion-inbox\.js'\)/u,
  );
  assert.match(
    shell,
    /key === 'profile'[\s\S]*dtpstat:profile-open/u,
  );

  assert.match(
    inbox,
    /\/api\/admin\/profile\/discussions/u,
  );
  assert.match(
    inbox,
    /geometry-editor\/geometries\/[\s\S]*\/discussion/u,
  );
  assert.match(
    inbox,
    /osm-boundaries\/[\s\S]*\/discussion/u,
  );
  assert.match(
    inbox,
    /apiPath\([\s\S]*'\/read'/u,
  );
  assert.match(
    inbox,
    /adminAvatarObjectUrl\(/u,
  );
  assert.match(
    inbox,
    /subscribeAdminRealtime\(/u,
  );
  assert.match(
    inbox,
    /event\?\.type ===[\s\S]*'data-change'[\s\S]*event\.change/u,
  );
  assert.match(
    inbox,
    /geometry-discussions/u,
  );
  assert.match(
    inbox,
    /osm-boundary-discussions/u,
  );
  assert.match(
    inbox,
    /className =[\s\S]*'admin-profile-unread'/u,
  );
  assert.match(
    inbox,
    /totalUnread/u,
  );
  assert.match(
    inbox,
    /readByOthersCount/u,
  );

  assert.match(
    inbox,
    /dtpstat:geometry-editor-select/u,
  );
  assert.match(
    inbox,
    /dtpstat:osm-boundary-editor-select/u,
  );
  assert.match(
    geometry,
    /dtpstat:geometry-editor-select[\s\S]*loadWorkspace[\s\S]*selectGeometry/u,
  );
  assert.match(
    osm,
    /dtpstat:osm-boundary-editor-select[\s\S]*selectBoundary/u,
  );
  assert.match(
    inbox,
    /openDiscussion:[\s\S]*true/u,
  );
  assert.match(
    geometry,
    /dtpstat:geometry-editor-select[\s\S]*openDiscussion[\s\S]*loadDiscussion/u,
  );
  assert.match(
    osm,
    /dtpstat:osm-boundary-editor-select[\s\S]*openDiscussion[\s\S]*loadDiscussion/u,
  );

  assert.match(
    styles,
    /\.profile-discussions-panel[\s\S]*grid-column: 1 \/ -1/u,
  );
  assert.match(
    styles,
    /\.profile-discussions-layout[\s\S]*grid-template-columns:/u,
  );
  assert.match(
    styles,
    /\.admin-profile-unread/u,
  );
  assert.match(
    styles,
    /\.profile-discussion-message\.is-own/u,
  );
});

test('OSM discussion read receipts are published and do not become unread messages', async () => {
  const [
    routes,
    editor,
  ] =
    await Promise.all([
      read(
        'src/routes/osm/boundary-routes.js',
      ),
      read(
        'admin/osm-boundary-editor.js',
      ),
    ]);

  assert.match(
    routes,
    /\/discussion\/read'[\s\S]*resource:[\s\S]*'osm-boundary-discussions'[\s\S]*action:[\s\S]*'read'[\s\S]*readerUserId/u,
  );
  assert.match(
    editor,
    /change\.action ===[\s\S]*'read'[\s\S]*discussionUnreadByBoundary[\s\S]*\.set\([\s\S]*boundaryId,[\s\S]*0/u,
  );
  assert.match(
    editor,
    /change\.action ===[\s\S]*'read'[\s\S]*loadDiscussion\([\s\S]*boundaryId/u,
  );
});
