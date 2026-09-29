import assert from 'node:assert/strict';
import test from 'node:test';
import {
  configureDatabase,
  configureRole,
  configureRuntimePrivileges,
  configureSchemaOwnership,
  transferObjectOwnership,
} from '../scripts/init-database.js';

function createClient(
  responses,
) {
  const queries = [];

  return {
    queries,
    async query(
      text,
      values,
    ) {
      queries.push({
        text:
          text.trim(),
        values,
      });

      const response =
        responses.shift();

      return (
        response ?? {
          rows: [],
        }
      );
    },
  };
}

test('existing role always receives the password supplied through env and no elevated role attributes', async () => {
  const client =
    createClient([
      {
        rows: [
          {
            exists: true,
          },
        ],
      },
      {
        rows: [],
      },
      {
        rows: [],
      },
    ]);

  const status =
    await configureRole(
      client,
      'buslanes',
      'new secret',
    );

  assert.equal(
    status,
    'updated',
  );
  assert.deepEqual(
    client.queries[1]
      .values,
    [
      'buslanes',
      'new secret',
    ],
  );
  assert.match(
    client.queries[2]
      .text,
    /ALTER ROLE %I WITH LOGIN PASSWORD %L/u,
  );
  assert.match(
    client.queries[2]
      .text,
    /NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS/u,
  );
});

test('existing database is retained and transferred to the migration owner role', async () => {
  const client =
    createClient([
      {
        rows: [
          {
            owner:
              'legacy_owner',
          },
        ],
      },
      {
        rows: [
          {
            sql:
              'ALTER DATABASE buslines OWNER TO buslanes_migrator',
          },
        ],
      },
      {
        rows: [],
      },
    ]);

  const status =
    await configureDatabase(
      client,
      'buslines',
      'buslanes_migrator',
    );

  assert.equal(
    status,
    'ownership-updated',
  );
  assert.equal(
    client.queries[2]
      .text,
    'ALTER DATABASE buslines OWNER TO buslanes_migrator',
  );
  assert.equal(
    client.queries.some(
      (query) =>
        query.text.startsWith(
          'CREATE DATABASE',
        ),
    ),
    false,
  );
});

test('database is created only when it does not exist and uses the migration owner', async () => {
  const client =
    createClient([
      {
        rows: [],
      },
      {
        rows: [
          {
            sql:
              'CREATE DATABASE buslines WITH OWNER buslanes_migrator',
          },
        ],
      },
      {
        rows: [],
      },
    ]);

  const status =
    await configureDatabase(
      client,
      'buslines',
      'buslanes_migrator',
    );

  assert.equal(
    status,
    'created',
  );
  assert.equal(
    client.queries[2]
      .text,
    'CREATE DATABASE buslines WITH OWNER buslanes_migrator',
  );
});

test('application schema and discovered objects move only to the migration owner', async () => {
  const statements = [
    'ALTER TABLE buslanes.cities OWNER TO buslanes_migrator',
    'ALTER SEQUENCE buslanes.cities_id_seq OWNER TO buslanes_migrator',
    'ALTER ROUTINE buslanes.refresh_stats() OWNER TO buslanes_migrator',
  ];

  const client =
    createClient([
      {
        rows: [],
      },
      {
        rows: [],
      },
      {
        rows:
          statements.map(
            (sql) => ({
              sql,
            }),
          ),
      },
      ...statements.map(
        () => ({
          rows: [],
        }),
      ),
    ]);

  await configureSchemaOwnership(
    client,
    'buslanes',
    'buslanes_migrator',
  );

  const count =
    await transferObjectOwnership(
      client,
      'buslanes_migrator',
      'buslanes',
    );

  assert.equal(
    count,
    statements.length,
  );
  assert.deepEqual(
    client.queries
      .slice(3)
      .map(
        (query) =>
          query.text,
      ),
    statements,
  );
  assert.deepEqual(
    client.queries[2]
      .values,
    [
      'buslanes_migrator',
      'buslanes',
    ],
  );
  assert.match(
    client.queries[2]
      .text,
    /namespace\.nspname =\s+\$2::text/u,
  );
  assert.match(
    client.queries[2]
      .text,
    /dependency\.deptype =\s+'e'/u,
  );
  assert.match(
    client.queries[2]
      .text,
    /ownership_dependency\.deptype IN/u,
  );
});

test('runtime role receives bounded DML privileges and future migrations keep the boundary', async () => {
  const client =
    createClient([
      {
        rows: [],
      },
      {
        rows: [],
      },
    ]);

  await configureRuntimePrivileges(
    client,
    {
      database:
        'buslines',
      schema:
        'buslanes',
      ownerRole:
        'buslanes_migrator',
      runtimeRole:
        'buslanes_app',
    },
  );

  assert.deepEqual(
    client.queries[0]
      .values,
    [
      'buslines',
      'buslanes',
      'buslanes_migrator',
      'buslanes_app',
    ],
  );

  const policy =
    client.queries[1]
      .text;

  assert.match(
    policy,
    /GRANT CONNECT, TEMPORARY ON DATABASE %I TO %I/u,
  );
  assert.match(
    policy,
    /REVOKE %I FROM %I/u,
  );
  assert.match(
    policy,
    /REVOKE CREATE ON SCHEMA public FROM PUBLIC/u,
  );
  assert.match(
    policy,
    /GRANT USAGE ON SCHEMA %I TO %I/u,
  );
  assert.match(
    policy,
    /GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO %I/u,
  );
  assert.match(
    policy,
    /GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA %I TO %I/u,
  );
  assert.match(
    policy,
    /GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA %I TO %I/u,
  );
  assert.match(
    policy,
    /ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I/u,
  );
  assert.match(
    policy,
    /ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC/u,
  );
});
