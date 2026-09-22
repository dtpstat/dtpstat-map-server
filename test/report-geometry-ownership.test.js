import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('report materialization uses canonical effective geometry ownership', async () => {
  const [report, transfer] = await Promise.all([
    fs.readFile(path.join(root, 'src/db/report-config-service.js'), 'utf8'),
    fs.readFile(path.join(root, 'src/db/project-settings-transfer-service.js'), 'utf8'),
  ]);
  for (const source of [report, transfer]) {
    assert.match(source, /effective_city_geometries/i);
  }
});
