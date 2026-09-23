import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  expectedMigrationState,
  verifyDatabaseMigrationState,
} from '../src/db/migration-state.js';

async function withMigrations(names, callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dtpstat-migrations-'));
  try {
    const directory = path.join(root, 'db', 'migrations');
    await fs.mkdir(directory, { recursive: true });
    await Promise.all(names.map((name) =>
      fs.writeFile(path.join(directory, name), '-- test\n')));
    return await callback(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function fakeDatabase({ exists = true, count, currentVersion, currentFile }) {
  return {
    databaseSchema: 'buslanes',
    async query(text) {
      if (text.includes('to_regclass')) {
        return { rows: [{ history: exists ? 'buslanes.schema_versions' : null }] };
      }
      if (text.includes('COUNT(*)::integer AS count')) {
        return {
          rows: [{
            count,
            currentVersion,
            currentFile,
          }],
        };
      }
      throw new Error(`Unexpected SQL: ${text}`);
    },
  };
}

test('expected migration state uses the repository migration sequence', async () => {
  await withMigrations([
    'V001__base.sql',
    'V002__second.sql',
    'README.md',
  ], async (root) => {
    assert.deepEqual(await expectedMigrationState(root), {
      version: 2,
      fileName: 'V002__second.sql',
      count: 2,
    });
  });
});

test('startup verification accepts matching migration state', async () => {
  await withMigrations([
    'V001__base.sql',
    'V002__second.sql',
  ], async (root) => {
    const state = await verifyDatabaseMigrationState(
      fakeDatabase({
        count: 2,
        currentVersion: 2,
        currentFile: 'V002__second.sql',
      }),
      { projectRoot: root, schema: 'buslanes' },
    );
    assert.equal(state.currentVersion, 2);
    assert.equal(state.expectedVersion, 2);
  });
});

test('startup verification rejects a database that is behind the application', async () => {
  await withMigrations([
    'V001__base.sql',
    'V002__second.sql',
  ], async (root) => {
    await assert.rejects(
      verifyDatabaseMigrationState(
        fakeDatabase({
          count: 1,
          currentVersion: 1,
          currentFile: 'V001__base.sql',
        }),
        { projectRoot: root, schema: 'buslanes' },
      ),
      /at V001.*requires V002.*npm run db:migrate/s,
    );
  });
});

test('startup verification rejects migration history gaps', async () => {
  await withMigrations([
    'V001__base.sql',
    'V002__second.sql',
    'V003__third.sql',
  ], async (root) => {
    await assert.rejects(
      verifyDatabaseMigrationState(
        fakeDatabase({
          count: 2,
          currentVersion: 3,
          currentFile: 'V003__third.sql',
        }),
        { projectRoot: root, schema: 'buslanes' },
      ),
      /history.*has a gap/s,
    );
  });
});

test('startup verification rejects a database newer than the application', async () => {
  await withMigrations([
    'V001__base.sql',
    'V002__second.sql',
  ], async (root) => {
    await assert.rejects(
      verifyDatabaseMigrationState(
        fakeDatabase({
          count: 3,
          currentVersion: 3,
          currentFile: 'V003__future.sql',
        }),
        { projectRoot: root, schema: 'buslanes' },
      ),
      /at V003.*only knows through V002/s,
    );
  });
});

test('startup verification rejects missing migration history', async () => {
  await withMigrations([
    'V001__base.sql',
  ], async (root) => {
    await assert.rejects(
      verifyDatabaseMigrationState(
        fakeDatabase({
          exists: false,
          count: 0,
          currentVersion: 0,
          currentFile: null,
        }),
        { projectRoot: root, schema: 'buslanes' },
      ),
      /no migration history.*npm run db:migrate/s,
    );
  });
});
