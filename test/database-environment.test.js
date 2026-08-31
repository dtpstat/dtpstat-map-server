import assert from 'node:assert/strict';
import test from 'node:test';
import {
  loadAdminDatabaseConnection,
  loadApplicationDatabaseConnection,
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
