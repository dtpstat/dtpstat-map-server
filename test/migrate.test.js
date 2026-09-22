import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  applyMigrations,
  parseMigrationFileName,
  renderMigrationSql,
  validateMigrationSequence,
} from '../scripts/migrate.js';
import { migrateDatabase } from '../src/db/migration-runner.js';

const migrations = [
  {
    version: 1,
    fileName: 'V001__base.sql',
    name: 'base',
    checksum: 'checksum-1',
    sql: 'MIGRATION ONE',
  },
  {
    version: 2,
    fileName: 'V002__next.sql',
    name: 'next',
    checksum: 'checksum-2',
    sql: 'MIGRATION TWO',
  },
];

test('migration filenames carry strict, contiguous versions', () => {
  assert.deepEqual(parseMigrationFileName('V002__population_stats.sql'), {
    version: 2,
    fileName: 'V002__population_stats.sql',
    name: 'population_stats',
  });
  assert.equal(parseMigrationFileName('002_population_stats.sql'), null);
  assert.deepEqual(
    validateMigrationSequence([
      { version: 2, fileName: 'V002__next.sql' },
      { version: 1, fileName: 'V001__base.sql' },
    ]).map((item) => item.version),
    [1, 2],
  );
  assert.throws(
    () =>
      validateMigrationSequence([
        { version: 1, fileName: 'V001__base.sql' },
        { version: 3, fileName: 'V003__gap.sql' },
      ]),
    /expected V002/,
  );
});

test('migration SQL substitutes schema at execution time without rewriting source files', () => {
  const source = [
    'CREATE SCHEMA IF NOT EXISTS BUSLANES;',
    'SET SEARCH_PATH = BUSLANES, PUBLIC;',
    "SELECT 'BUSLANES.LINE_TYPES'::REGCLASS;",
  ].join('\n');

  assert.equal(
    renderMigrationSql(source, 'tramlanes'),
    [
      'CREATE SCHEMA IF NOT EXISTS tramlanes;',
      'SET SEARCH_PATH = tramlanes, PUBLIC;',
      "SELECT 'tramlanes.LINE_TYPES'::REGCLASS;",
    ].join('\n'),
  );
  assert.match(source, /BUSLANES/);
});

function createClient(appliedRows = [], { legacyHistory = false } = {}) {
  const queries = [];
  return {
    queries,
    async query(text, values) {
      const normalized = text.trim();
      queries.push({ text: normalized, values });
      if (normalized.startsWith('SELECT to_regclass')) {
        return { rows: [{ legacy: legacyHistory ? 'buslanes_schema_versions' : null }] };
      }
      if (normalized.startsWith('SELECT version, filename, checksum')) {
        return { rows: appliedRows };
      }
      return { rows: [] };
    },
  };
}

test('migration runner applies every pending version in its own transaction', async () => {
  const client = createClient();

  const result = await applyMigrations(client, migrations);

  assert.equal(result.version, 2);
  assert.equal(result.appliedCount, 2);
  assert.equal(result.totalCount, 2);
  assert.equal(
    client.queries.some((query) => query.text === 'CREATE SCHEMA IF NOT EXISTS buslanes'),
    true,
  );
  assert.equal(
    client.queries.some((query) => query.text.includes('CREATE TABLE IF NOT EXISTS buslanes.schema_versions')),
    true,
  );
  assert.deepEqual(
    client.queries
      .map((query) => query.text)
      .filter((query) => query.startsWith('MIGRATION') || query === 'BEGIN' || query === 'COMMIT'),
    ['BEGIN', 'MIGRATION ONE', 'COMMIT', 'BEGIN', 'MIGRATION TWO', 'COMMIT'],
  );
});

test('migration runner isolates history in the configured schema', async () => {
  const client = createClient();

  await applyMigrations(client, migrations, { schema: 'tramlanes' });

  assert.equal(
    client.queries.some((query) => query.text === 'CREATE SCHEMA IF NOT EXISTS tramlanes'),
    true,
  );
  assert.equal(
    client.queries.some((query) => query.text.includes('tramlanes.schema_versions')),
    true,
  );
  assert.equal(
    client.queries.some((query) => query.text.includes('public.buslanes_schema_versions')),
    false,
  );
});

test('default schema imports legacy migration history for existing databases', async () => {
  const client = createClient([], { legacyHistory: true });

  await applyMigrations(client, migrations);

  assert.equal(
    client.queries.some((query) =>
      query.text.includes('FROM public.buslanes_schema_versions')),
    true,
  );
});

test('migration runner resumes after the last recorded version', async () => {
  const client = createClient([
    {
      version: 1,
      filename: 'V001__base.sql',
      checksum: 'checksum-1',
    },
  ]);

  await applyMigrations(client, migrations);

  assert.equal(
    client.queries.some((query) => query.text === 'MIGRATION ONE'),
    false,
  );
  assert.equal(
    client.queries.some((query) => query.text === 'MIGRATION TWO'),
    true,
  );
});

test('migration runner refuses changed history without executing SQL', async () => {
  const client = createClient([
    {
      version: 1,
      filename: 'V001__base.sql',
      checksum: 'different-checksum',
    },
  ]);

  await assert.rejects(
    applyMigrations(client, migrations),
    /Applied migration was modified/,
  );
  assert.equal(
    client.queries.some((query) => query.text.startsWith('MIGRATION')),
    false,
  );
});


async function withMigrationDirectory(files, callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dtpstat-runner-'));
  try {
    const directory = path.join(root, 'db', 'migrations');
    await fs.mkdir(directory, { recursive: true });
    for (const [fileName, sql] of Object.entries(files)) {
      await fs.writeFile(path.join(directory, fileName), sql);
    }
    return await callback(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function autoMigrationPool({ failOnSql = null } = {}) {
  const queries = [];
  let released = false;
  const client = {
    async query(text, values) {
      const normalized = text.trim();
      queries.push({ text: normalized, values });
      if (failOnSql && normalized.includes(failOnSql)) {
        throw new Error('synthetic migration failure');
      }
      if (normalized.startsWith('SELECT to_regclass')) {
        return { rows: [{ legacy: null }] };
      }
      if (normalized.startsWith('SELECT version, filename, checksum')) {
        return { rows: [] };
      }
      return { rows: [] };
    },
    release() {
      released = true;
    },
  };
  return {
    databaseSchema: 'buslanes',
    queries,
    get released() { return released; },
    async connect() { return client; },
  };
}

test('automatic migration runner serializes startup with an advisory lock', async () => {
  await withMigrationDirectory({
    'V001__base.sql': 'MIGRATION ONE',
    'V002__next.sql': 'MIGRATION TWO',
  }, async (projectRoot) => {
    const pool = autoMigrationPool();
    const events = [];
    const result = await migrateDatabase(pool, {
      projectRoot,
      schema: 'buslanes',
      logger(event) { events.push(event); },
    });

    assert.equal(result.version, 2);
    assert.equal(result.appliedCount, 2);
    assert.equal(result.totalCount, 2);
    assert.deepEqual(
      events.filter((event) => event.status === 'applied')
        .map((event) => event.migration.fileName),
      ['V001__base.sql', 'V002__next.sql'],
    );
    assert.equal(
      pool.queries[0].text,
      'SELECT pg_advisory_lock(hashtext($1))',
    );
    assert.deepEqual(pool.queries[0].values, ['buslanes:migrations']);
    assert.equal(
      pool.queries.at(-1).text,
      'SELECT pg_advisory_unlock(hashtext($1))',
    );
    assert.equal(pool.released, true);
  });
});

test('automatic migration runner unlocks and releases after migration failure', async () => {
  await withMigrationDirectory({
    'V001__base.sql': 'MIGRATION FAIL',
  }, async (projectRoot) => {
    const pool = autoMigrationPool({ failOnSql: 'MIGRATION FAIL' });

    await assert.rejects(
      migrateDatabase(pool, {
        projectRoot,
        schema: 'buslanes',
      }),
      /synthetic migration failure/,
    );

    assert.ok(pool.queries.some((query) => query.text === 'ROLLBACK'));
    assert.equal(
      pool.queries.at(-1).text,
      'SELECT pg_advisory_unlock(hashtext($1))',
    );
    assert.equal(pool.released, true);
  });
});
