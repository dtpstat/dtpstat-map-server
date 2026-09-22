import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('conflict resolver never duplicates an incoming row that already has exact same-tags match', async () => {
  const [repository, editor] = await Promise.all([
    fs.readFile(path.join(root, 'src/db/geometry-import-repository.js'), 'utf8'),
    fs.readFile(path.join(root, 'admin/geometry-editor.js'), 'utf8'),
  ]);

  assert.match(repository, /loadConflictAutoMatches/);
  assert.match(repository, /add-new would create a duplicate/);
  assert.match(repository, /UPDATE_EXISTING_FROM_STAGE_SQL,[\s\S]*autoExistingId/);
  assert.match(repository, /DELETE FROM city_geometries WHERE id = ANY/);
  assert.match(repository, /conflictAutoMatched/);

  assert.match(editor, /conflictAdd\.disabled = Boolean\(conflict\.autoExistingId\)/);
  assert.match(editor, /incoming уже имеет точное совпадение/);
});
