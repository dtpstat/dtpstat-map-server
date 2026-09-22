import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('geometry editor repairs active OSM boundaries missing city links before listing', async () => {
  const source = await fs.readFile(
    path.join(root, 'src/db/geometry-editor-repository.js'),
    'utf8',
  );

  assert.match(source, /COUNT\(\*\) FILTER \(WHERE city_id IS NULL\)/);
  assert.match(source, /await acquireDataImportLock\(client, pool\)/);
  assert.match(source, /SELECT sync_active_boundary_cities\(\)/);
  assert.match(source, /async listCities\(\) \{[\s\S]*ensureActiveBoundaryCities\(\)/);
  assert.match(source, /async listCityGeometries\(cityId\) \{[\s\S]*ensureActiveBoundaryCities\(\)/);
});

test('geometry editor migration backfills active boundary city links', async () => {
  const migration = await fs.readFile(
    path.join(root, 'db/migrations/V037__sync_geometry_editor_cities.sql'),
    'utf8',
  );
  assert.match(migration, /SYNC_ACTIVE_BOUNDARY_CITIES\(\)/i);
});
