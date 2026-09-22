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

test('current user and audit rows render profile avatars with fallback initials', async () => {
  const [html, shell, editor, route] = await Promise.all([
    read('admin/index.html'),
    read('admin/admin-shell.js'),
    read('admin/security-editor-v2.js'),
    read('src/routes/admin-security-api.js'),
  ]);

  assert.match(html, /id="admin-user-avatar-image"/);
  assert.match(html, /id="admin-user-avatar-fallback"/);
  assert.match(html, /id="admin-user-label"/);
  assert.match(html, /id="admin-user-roles"/);
  assert.match(shell, /\/api\/admin\/profile\/avatar\?v=\$\{Date\.now\(\)\}/);
  assert.match(shell, /user\.hasAvatar/);
  assert.match(shell, /rolesHost\.replaceChildren/);
  assert.match(shell, /tag\.className = 'admin-user-role'/);

  assert.match(editor, /function auditUserCell\(entry\)/);
  assert.match(editor, /entry\.hasAvatar/);
  assert.match(
    editor,
    /\/api\/admin\/security\/users\/\$\{encodeURIComponent\(entry\.userId\)\}\/avatar/,
  );
  assert.match(route, /\/admin\/security\/users\/:userId\/avatar/);
  assert.match(route, /adminAuth\.requireAudit/);
});
