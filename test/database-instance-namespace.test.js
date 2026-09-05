import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

async function source(relativePath) {
  return fs.readFile(path.join(projectRoot, relativePath), 'utf8');
}

test('runtime database namespace is not tied to the repository name', async () => {
  const files = await Promise.all([
    'src/config.js',
    'src/db/pool.js',
    'src/db/database-locks.js',
    'src/db/data-import-service.js',
    'src/db/city-boundary-transfer-service.js',
    'src/db/population-import-service.js',
    'src/db/line-types-repository.js',
    'src/db/kml-update-service.js',
    'src/db/osm-city-update-service.js',
    'scripts/database.js',
    'scripts/import-data.js',
    'scripts/migrate.js',
    'scripts/init-database.js',
  ].map(source));

  const runtime = files.join('\n');
  assert.doesNotMatch(runtime, /dtpstat-buslines:data-import/);
  assert.doesNotMatch(runtime, /dtpstat-buslines:migrations/);
  assert.doesNotMatch(runtime, /dtpstat-buslines\/2\.0 OSM city updater/);
  assert.doesNotMatch(runtime, /-c search_path=buslanes,public/);
  assert.doesNotMatch(runtime, /application_name:\s*['"]dtpstat-buslines/);
});

test('schema setting drives search path, migration rendering and lock namespace', async () => {
  const [environment, migrate, example] = await Promise.all([
    source('src/db/database-environment.js'),
    source('scripts/migrate.js'),
    source('.env.example'),
  ]);

  assert.match(environment, /DEFAULT_DATABASE_SCHEMA = 'buslanes'/);
  assert.match(environment, /DATABASE_SCHEMA/);
  assert.match(environment, /search_path=\$\{normalizeDatabaseSchema\(schema\)\},public/);
  assert.match(environment, /\$\{namespace\}:\$\{name\}/);
  assert.match(migrate, /renderMigrationSql/);
  assert.match(migrate, /schema_versions/);
  assert.match(example, /^DATABASE_SCHEMA=buslanes$/m);
});
