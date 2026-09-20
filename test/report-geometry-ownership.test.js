import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('report materialization uses CITY_ID ownership instead of geometry boundary activity', async () => {
  const [report, transfer] = await Promise.all([
    fs.readFile(path.join(root, 'src/db/report-config-service.js'), 'utf8'),
    fs.readFile(path.join(root, 'src/db/project-settings-transfer-service.js'), 'utf8'),
  ]);
  for (const source of [report, transfer]) {
    assert.match(source, /geometry_presence\.city_id = city\.id/);
    assert.doesNotMatch(
      source,
      /geometry_boundary\.id = geometry_presence\.boundary_id[\s\S]{0,120}geometry_boundary\.is_active/,
    );
  }
});
