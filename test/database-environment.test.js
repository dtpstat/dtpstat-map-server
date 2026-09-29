import assert from 'node:assert/strict';
import test from 'node:test';
import {
  databaseApplicationName,
  databaseLockKey,
  databaseSearchPath,
  loadAdminDatabaseConnection,
  loadApplicationDatabaseConnection,
  loadDatabaseSchema,
  loadMigrationDatabaseConnection,
} from '../src/db/database-environment.js';

test('application database connection uses the dedicated role from env', () => {
  const connection = loadApplicationDatabaseConnection({
    DATABASE_HOST: 'database.internal',
    DATABASE_PORT: '55432',
    DATABASE_NAME: 'buslines',
    DATABASE_ROLE: 'buslines_app',
    DATABASE_ROLE_PASSWORD: ' secret with spaces ',
    DATABASE_SSL: 'true',
    DATABASE_SSL_REJECT_UNAUTHORIZED: 'false',
  });

  assert.deepEqual(connection, {
    host: 'database.internal',
    port: 55432,
    database: 'buslines',
    user: 'buslines_app',
    password: ' secret with spaces ',
    ssl: { rejectUnauthorized: false },
  });
});

test('migration database connection can be separated from the runtime role', () => {
  const dedicated =
    loadMigrationDatabaseConnection({
      DATABASE_HOST:
        'database.internal',
      DATABASE_PORT:
        '55432',
      DATABASE_NAME:
        'buslines',
      DATABASE_ROLE:
        'buslines_app',
      DATABASE_ROLE_PASSWORD:
        'app-secret',
      DATABASE_MIGRATION_ROLE:
        'buslines_migrator',
      DATABASE_MIGRATION_ROLE_PASSWORD:
        'migration-secret',
    });

  assert.equal(
    dedicated.user,
    'buslines_migrator',
  );
  assert.equal(
    dedicated.password,
    'migration-secret',
  );

  const fallback =
    loadMigrationDatabaseConnection({
      DATABASE_NAME:
        'buslines',
      DATABASE_ROLE:
        'buslines_app',
      DATABASE_ROLE_PASSWORD:
        'app-secret',
    });

  assert.equal(
    fallback.user,
    'buslines_app',
  );
  assert.equal(
    fallback.password,
    'app-secret',
  );
});

test('database schema is a safe instance namespace with a backward-compatible default', () => {
  assert.equal(loadDatabaseSchema({}), 'buslanes');
  assert.equal(loadDatabaseSchema({ DATABASE_SCHEMA: 'tramlanes' }), 'tramlanes');
  assert.equal(databaseSearchPath('tramlanes'), '-c search_path=tramlanes,public');
  assert.equal(databaseApplicationName('tramlanes', 'server'), 'tramlanes:server');
  assert.equal(databaseLockKey('tramlanes', 'data-import'), 'tramlanes:data-import');

  for (const invalid of [
    'Public',
    'public',
    'pg_temp',
    'information_schema',
    'two-projects',
    '2project',
    'with space',
  ]) {
    assert.throws(
      () => loadDatabaseSchema({ DATABASE_SCHEMA: invalid }),
      /DATABASE_SCHEMA/,
    );
  }
});

test('admin connection is restricted to postgres and has separate credentials', () => {
  const connection = loadAdminDatabaseConnection({
    DATABASE_NAME: 'buslines',
    DATABASE_ROLE: 'buslines_app',
    DATABASE_ROLE_PASSWORD: 'app-secret',
    POSTGRES_ADMIN_PASSWORD: 'admin-secret',
  });

  assert.equal(connection.database, 'postgres');
  assert.equal(connection.user, 'postgres');
  assert.equal(connection.password, 'admin-secret');

  assert.throws(
    () =>
      loadAdminDatabaseConnection({
        POSTGRES_ADMIN_USER: 'another_superuser',
        POSTGRES_ADMIN_PASSWORD: 'secret',
      }),
    /must be postgres/,
  );
});
