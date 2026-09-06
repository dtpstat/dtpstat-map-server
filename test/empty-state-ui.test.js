import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

test('public client treats a fresh empty database as a normal empty state', async () => {
  const source = await fs.readFile(
    path.join(projectRoot, 'public/js/app.js'),
    'utf8',
  );

  assert.doesNotMatch(source, /throw new Error\('Список городов пуст'\)/);
  assert.match(source, /if \(!cities\.length\) \{/);
  assert.match(source, /Данные пока не загружены/);
  assert.match(source, /setMapMessage\('Данные пока не загружены'\)/);
});
