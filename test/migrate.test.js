import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyMigrations,
  parseMigrationFileName,
  validateMigrationSequence,
} from '../scripts/migrate.js';

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

function createClient(appliedRows = []) {
  const queries = [];
  return {
    queries,
    async query(text, values) {
      const normalized = text.trim();
      queries.push({ text: normalized, values });
      if (normalized.startsWith('SELECT version, filename, checksum')) {
        return { rows: appliedRows };
      }
      return { rows: [] };
    },
  };
}

test('migration runner applies every pending version in its own transaction', async () => {
  const client = createClient();

  const version = await applyMigrations(client, migrations);

  assert.equal(version, 2);
  assert.deepEqual(
    client.queries
      .map((query) => query.text)
      .filter((query) => query.startsWith('MIGRATION') || query === 'BEGIN' || query === 'COMMIT'),
    ['BEGIN', 'MIGRATION ONE', 'COMMIT', 'BEGIN', 'MIGRATION TWO', 'COMMIT'],
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
