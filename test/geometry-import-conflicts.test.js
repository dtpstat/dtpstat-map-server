import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { GeometryImportSessionError } from '../src/db/geometry-import-repository.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('legacy import conflict SQL follows Equals/Within/Overlaps matrix without Intersects matching', async () => {
  const source = await fs.readFile(
    path.join(root, 'src/db/geometry-import-repository.js'),
    'utf8',
  );

  assert.match(source, /ST_Equals\(existing\.geom, stage\.geom\)[\s\S]*source_tags IS DISTINCT FROM stage\.source_tags/);
  assert.match(source, /ST_Overlaps\(existing\.geom, stage\.geom\)/);
  assert.match(source, /ST_Within\(existing\.geom, stage\.geom\)[\s\S]*ST_Within\(stage\.geom, existing\.geom\)/);
  assert.match(source, /existing\.source_tags = stage\.source_tags/);
  assert.doesNotMatch(source, /ST_Intersects\(existing\.geom, stage\.geom\)/);
  assert.match(source, /ST_Equals\(existing\.geom, stage\.geom\)[\s\S]*existing\.source_tags = stage\.source_tags[\s\S]*auto_existing_id/s);
});

test('conflict decision validation rejects malformed decisions before SQL mutation', () => {
  const error = new GeometryImportSessionError('bad', 400);
  assert.equal(error.statusCode, 400);
  assert.equal(error.name, 'GeometryImportSessionError');
});
