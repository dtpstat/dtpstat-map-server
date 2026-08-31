import assert from 'node:assert/strict';
import test from 'node:test';
import {
  configureDatabase,
  configureRole,
  transferObjectOwnership,
} from '../scripts/init-database.js';

function createClient(responses) {
  const queries = [];
  return {
    queries,
    async query(text, values) {
      queries.push({ text: text.trim(), values });
      const response = responses.shift();
      return response ?? { rows: [] };
    },
  };
}

test('existing role always receives the password supplied through env', async () => {
  const client = createClient([
    { rows: [{ exists: true }] },
    { rows: [] },
    { rows: [] },
  ]);

  const status = await configureRole(client, 'buslanes', 'new secret');

  assert.equal(status, 'updated');
  assert.deepEqual(client.queries[1].values, ['buslanes', 'new secret']);
  assert.match(client.queries[2].text, /ALTER ROLE %I WITH LOGIN PASSWORD %L/);
});

test('existing database is retained and transferred to the application role', async () => {
  const client = createClient([
    { rows: [{ owner: 'legacy_owner' }] },
    { rows: [{ sql: 'ALTER DATABASE buslines OWNER TO buslanes' }] },
    { rows: [] },
  ]);

  const status = await configureDatabase(client, 'buslines', 'buslanes');

  assert.equal(status, 'ownership-updated');
  assert.equal(
    client.queries[2].text,
    'ALTER DATABASE buslines OWNER TO buslanes',
  );
  assert.equal(
    client.queries.some((query) => query.text.startsWith('CREATE DATABASE')),
    false,
  );
});

test('database is created only when it does not exist', async () => {
  const client = createClient([
    { rows: [] },
    { rows: [{ sql: 'CREATE DATABASE buslines WITH OWNER buslanes' }] },
    { rows: [] },
  ]);

  const status = await configureDatabase(client, 'buslines', 'buslanes');

  assert.equal(status, 'created');
  assert.equal(
    client.queries[2].text,
    'CREATE DATABASE buslines WITH OWNER buslanes',
  );
});

test('every discovered user object receives the application role', async () => {
  const statements = [
    'ALTER SCHEMA buslanes OWNER TO buslanes',
    'ALTER TABLE buslanes.cities OWNER TO buslanes',
    'ALTER SEQUENCE buslanes.cities_id_seq OWNER TO buslanes',
    'ALTER ROUTINE buslanes.refresh_stats() OWNER TO buslanes',
  ];
  const client = createClient([
    { rows: statements.map((sql) => ({ sql })) },
    ...statements.map(() => ({ rows: [] })),
  ]);

  const count = await transferObjectOwnership(client, 'buslanes');

  assert.equal(count, statements.length);
  assert.deepEqual(
    client.queries.slice(1).map((query) => query.text),
    statements,
  );
  assert.match(client.queries[0].text, /dependency\.deptype = 'e'/);
  assert.match(
    client.queries[0].text,
    /ownership_dependency\.deptype IN \('a', 'i'\)/,
  );
});
