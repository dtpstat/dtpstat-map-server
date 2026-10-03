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

test('dedicated discussion inbox unifies geometry and OSM threads with realtime unread state', async () => {
  const [
    shell,
    inbox,
    styles,
    layout,
    layoutSchema,
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
        'admin/admin-layout.js',
      ),
      read(
        'admin/admin-layout-schema.js',
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
    /ensureAdminSections\([\s\S]*adminDynamicSections/u,
  );
  assert.doesNotMatch(
    shell,
    /function ensureMessagesSection/u,
  );
  assert.doesNotMatch(
    shell,
    /function ensureProfileSection/u,
  );
  assert.match(
    layoutSchema,
    /id:[\s\S]*'messages-list'[\s\S]*hostId:[\s\S]*'discussion-inbox-list-host'[\s\S]*wide:\s*4/u,
  );
  assert.match(
    layoutSchema,
    /id:[\s\S]*'messages-thread'[\s\S]*hostId:[\s\S]*'discussion-inbox-thread-host'[\s\S]*wide:\s*8/u,
  );
  for (
    const hostId of [
      'profile-account-host',
      'profile-password-host',
      'profile-mfa-host',
      'profile-sessions-host',
    ]
  ) {
    assert.match(
      layoutSchema,
      new RegExp(
        `id:[\\s\\S]*'profile'[\\s\\S]*hostId:[\\s\\S]*'${hostId}'`,
        'u',
      ),
    );
  }
  assert.doesNotMatch(
    layoutSchema,
    /profile-editor-host/u,
  );
  assert.match(
    layout,
    /grid-template-columns|admin-layout-grid/u,
  );
  assert.match(
    shell,
    /messages:[\s\S]*canEditGeometries\(user\)[\s\S]*canEditOsm\(user\)/u,
  );
  assert.match(
    shell,
    /key === 'messages'[\s\S]*dtpstat:messages-open/u,
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
    /discussion-inbox-list-host/u,
  );
  assert.match(
    inbox,
    /discussion-inbox-thread-host/u,
  );
  assert.doesNotMatch(
    inbox,
    /discussion-inbox-host/u,
  );
  assert.doesNotMatch(
    inbox,
    /profile-editor-host/u,
  );
  assert.match(
    inbox,
    /className =[\s\S]*'admin-messages-unread'/u,
  );
  assert.match(
    inbox,
    /totalUnread/u,
  );
  assert.match(
    inbox,
    /admin-messages-read-all/u,
  );
  assert.match(
    inbox,
    /\/api\/admin\/profile\/discussions\/read-all/u,
  );
  assert.match(
    inbox,
    /dtpstat:discussion-inbox-open/u,
  );
  assert.match(
    inbox,
    /pendingOpenKey/u,
  );
  assert.match(
    inbox,
    /classList\.toggle\([\s\S]*'has-unread'/u,
  );

  assert.match(
    inbox,
    /readByOthersCount/u,
  );
  assert.match(
    inbox,
    /new IntersectionObserver\(/u,
  );
  assert.match(
    inbox,
    /threshold:\s*\[0\.6\]/u,
  );
  assert.match(
    inbox,
    /const incoming =[\s\S]*state\.messages\.filter/u,
  );
  assert.match(
    inbox,
    /const unreadCount =[\s\S]*item\.unreadCount[\s\S]*incoming\.length/u,
  );
  assert.match(
    inbox,
    /const unreadIds =[\s\S]*incoming[\s\S]*\.slice\(/u,
  );
  assert.match(
    inbox,
    /firstUnread[\s\S]*messages\.scrollTop/u,
  );
  assert.doesNotMatch(
    inbox,
    /const last =[\s\S]*markRead\([\s\S]*last\.id/u,
  );
  assert.match(
    inbox,
    /threadRequestSequence/u,
  );
  assert.match(
    inbox,
    /requestSequence !==[\s\S]*state\.threadRequestSequence[\s\S]*state\.selectedKey !==[\s\S]*itemKey/u,
  );
  assert.match(
    inbox,
    /change\?\.action ===[\s\S]*'read'[\s\S]*change\.readerUserId[\s\S]*currentUser\.id/u,
  );
  assert.doesNotMatch(
    inbox,
    /state\.loadingThread \|\|[\s\S]*!item/u,
  );

  assert.match(
    inbox,
    /dtpstat:geometry-editor-select/u,
  );
  assert.match(
    inbox,
    /dtpstat:geometry-editor-navigation-pending/u,
  );
  assert.match(
    inbox,
    /geometry-editor-navigation-pending[\s\S]*tab\.click\(\)[\s\S]*geometry-editor-select/u,
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
    geometry,
    /workspaceRequestSequence/u,
  );
  assert.match(
    geometry,
    /pendingTargetNavigation/u,
  );
  assert.match(
    geometry,
    /geometry-editor-open[\s\S]*!state\.pendingTargetNavigation[\s\S]*refresh\(/u,
  );
  assert.match(
    geometry,
    /requestSequence !==[\s\S]*state\.workspaceRequestSequence[\s\S]*return false/u,
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
    /\.admin-messages-card[\s\S]*grid-template-rows:/u,
  );
  assert.match(
    styles,
    /\.admin-messages-card \.admin-layout-grid[\s\S]*grid-auto-rows:/u,
  );
  assert.match(
    styles,
    /\.discussion-inbox-thread-panel[\s\S]*grid-template-rows:/u,
  );
  assert.doesNotMatch(
    styles,
    /\.profile-discussions-layout/u,
  );
  assert.match(
    styles,
    /\.admin-messages-unread/u,
  );
  assert.match(
    styles,
    /\.profile-discussion-row\.has-unread/u,
  );
  assert.match(
    styles,
    /\.admin-messages-read-all/u,
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
