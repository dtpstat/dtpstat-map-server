import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFile(path.join(root, relativePath), 'utf8');

test('geometry editor role crosses persistence service authorization and security UI boundaries', async () => {
  const [repository, sessionRepository, securityPolicy, accountService, authorizationPolicy, auth, editor] = await Promise.all([
    read('src/db/admin-user-repository.js'),
    read('src/db/admin-session-repository.js'),
    read('src/modules/security/policy.js'),
    read('src/modules/security/account-service.js'),
    read('src/modules/security/authorization-policy.js'),
    read('src/http/admin-auth.js'),
    read('admin/security-editor-v2.js'),
  ]);
  assert.match(repository, /can_edit_geometries AS "canEditGeometries"/);
  assert.match(repository, /can_edit_geometries = \$7/);
  assert.match(sessionRepository, /can_edit_geometries AS "canEditGeometries"/);
  assert.match(securityPolicy, /canEditGeometries: Boolean/);
  assert.match(accountService, /'canEditGeometries'/);
  assert.match(authorizationPolicy, /permission === 'geometry-editor'/);
  assert.match(auth, /requireGeometryEditor:\s*middleware\('geometry-editor'\)/);
  assert.match(editor, /roleCheckbox\('canEditGeometries', 'Редактирование геометрий'/);
  assert.match(editor, /canEditGeometries: form\.elements\.canEditGeometries\.checked/);
});
