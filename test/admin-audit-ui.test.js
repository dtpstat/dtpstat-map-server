import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function read(relativePath) {
  return fs.readFile(path.join(root, relativePath), 'utf8');
}

test('audit details use external foldable modal instead of inline JSON', async () => {
  const [editor, styles] = await Promise.all([
    read('admin/security-editor-v2.js'),
    read('admin/security-v2.css'),
  ]);

  assert.match(editor, /id="security-audit-detail-overlay"/);
  assert.match(editor, /data-audit-view="tree"/);
  assert.match(editor, /data-audit-view="raw"/);
  assert.match(editor, /security-audit-expand-all/);
  assert.match(editor, /security-audit-collapse-all/);
  assert.match(editor, /security-audit-copy-json/);
  assert.match(editor, /function jsonTreeNode\(/);
  assert.match(editor, /function ensureJsonBranch\(/);
  assert.match(editor, /jsonBranchRenderers = new WeakMap\(\)/);
  assert.match(editor, /button\.addEventListener\('click', \(\) => openAuditDetails\(entry\)\)/);
  assert.doesNotMatch(
    editor,
    /pre\.textContent = JSON\.stringify\(entry\.details/,
  );

  assert.match(styles, /\.security-audit-detail-overlay\s*\{/);
  assert.match(styles, /\.security-audit-detail-dialog\s*\{/);
  assert.match(styles, /\.security-json-branch/);
  assert.match(styles, /body\.security-modal-open/);
});

test('current user and audit rows render stable avatar URLs with fallback initials', async () => {
  const [html, shell, editor, route, styles] = await Promise.all([
    read('admin/index.html'),
    read('admin/admin-shell.js'),
    read('admin/security-editor-v2.js'),
    read('src/routes/security/user-routes.js'),
    read('admin/security-v2.css'),
  ]);

  assert.match(html, /id="admin-user-avatar-image"/);
  assert.match(html, /id="admin-user-avatar-fallback"/);
  assert.match(html, /id="admin-user-label"/);
  assert.match(html, /id="admin-user-roles"/);
  assert.match(shell, /user\.hasAvatar/);
  assert.match(shell, /rolesHost\.replaceChildren/);
  assert.match(shell, /tag\.className = 'admin-user-role'/);

  assert.match(editor, /function userListRow\(user\)/);
  assert.match(editor, /if \(user\.hasAvatar\)/);
  assert.match(editor, /avatarVersion = encodeURIComponent\(user\.updatedAt \?\? '1'\)/);
  assert.match(editor, /loadedAvatarUrls = new Set\(\)/);
  assert.match(editor, /function applyAvatarBackground\(avatar, fallback, url\)/);
  assert.match(editor, /avatar\.style\.backgroundImage/);
  assert.match(editor, /avatar\.classList\.add\('is-image-loaded'\)/);
  assert.match(editor, /loadedAvatarUrls\.add\(url\)/);
  assert.doesNotMatch(editor, /image\.hidden = true/);
  assert.doesNotMatch(editor, /image\.addEventListener\('load'/);

  assert.match(editor, /function auditUserCell\(entry\)/);
  assert.match(editor, /if \(entry\.userId\)/);
  assert.match(editor, /applyAvatarBackground\(avatar, fallback, avatarUrl\)/);
  assert.match(editor, /security-audit-avatar-fallback/);
  assert.match(
    editor,
    /\/api\/admin\/security\/users\/\$\{encodeURIComponent\(entry\.userId\)\}\/avatar/,
  );
  assert.match(route, /\/admin\/security\/users\/:userId\/avatar/);
  assert.match(route, /adminAuth\.requireUsersOrAudit/);
  assert.match(styles, /\.security-user-avatar\.is-image-loaded \.security-user-avatar-fallback/);
  assert.match(styles, /\.security-audit-avatar\.is-image-loaded \.security-audit-avatar-fallback/);
  assert.match(editor, /security-password-policy-row/);
  assert.match(styles, /\.security-password-policy-row\s*\{/);
  assert.match(styles, /\.security-password-minimum\s*\{/);
});

test('profile avatar hides fallback only after successful image load', async () => {
  const [profile, styles] = await Promise.all([
    read('admin/profile-editor.js'),
    read('admin/profile.css'),
  ]);

  assert.match(profile, /image\.onload = \(\) => \{/);
  assert.match(profile, /image\.onerror = \(\) => \{/);
  assert.match(profile, /image\.hidden = false;[\s\S]*fallback\.hidden = true;/);
  assert.match(profile, /image\.hidden = true;[\s\S]*fallback\.hidden = false;/);
  assert.match(styles, /\.profile-avatar\[hidden\] \{ display: none !important; \}/);
});



