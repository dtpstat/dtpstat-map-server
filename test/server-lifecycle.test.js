import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createServerShutdown,
  installProcessShutdownHandlers,
} from '../src/application/server-lifecycle.js';

test('server shutdown closes websocket listeners and pool once', async () => {
  const calls = [];
  const logs = [];
  const serverA = { id: 'a' };
  const serverB = { id: 'b' };
  const times = [100, 125];

  const shutdown =
    createServerShutdown({
      servers: [
        serverA,
        serverB,
      ],
      adminWebSocket: {
        async close() {
          calls.push('websocket');
        },
      },
      pool: {
        async end() {
          calls.push('pool');
        },
      },
      async closeHttpServer(
        server,
      ) {
        calls.push(
          `server:${server.id}`,
        );
        if (server === serverB) {
          throw new Error(
            'listener failed',
          );
        }
      },
      async runOperation(
        _event,
        operation,
      ) {
        return operation();
      },
      log(
        level,
        event,
        details,
      ) {
        logs.push({
          level,
          event,
          details,
        });
      },
      now() {
        return times.shift();
      },
    });

  await shutdown('SIGTERM');

  assert.deepEqual(
    calls,
    [
      'websocket',
      'server:a',
      'server:b',
      'pool',
    ],
  );
  assert.deepEqual(
    logs.find(
      ({ event }) =>
        event ===
        'http-servers.close:partial',
    ),
    {
      level: 'warning',
      event:
        'http-servers.close:partial',
      details: {
        failed: 1,
        total: 2,
      },
    },
  );
  assert.deepEqual(
    logs.at(-1),
    {
      level: 'info',
      event: 'shutdown:ok',
      details: {
        signal: 'SIGTERM',
        durationMs: 25,
      },
    },
  );

  await shutdown('SIGINT');

  assert.deepEqual(
    calls,
    [
      'websocket',
      'server:a',
      'server:b',
      'pool',
    ],
  );
  assert.deepEqual(
    logs.at(-1),
    {
      level: 'warning',
      event:
        'shutdown:duplicate',
      details: {
        signal: 'SIGINT',
      },
    },
  );
});

test('process shutdown handlers exit zero after successful shutdown', async () => {
  const handlers = new Map();
  const exits = [];
  const signals = [];

  installProcessShutdownHandlers({
    async shutdown(signal) {
      signals.push(signal);
    },
    processRuntime: {
      once(signal, handler) {
        handlers.set(
          signal,
          handler,
        );
      },
      exit(code) {
        exits.push(code);
      },
    },
  });

  assert.deepEqual(
    [...handlers.keys()],
    ['SIGINT', 'SIGTERM'],
  );

  await handlers.get(
    'SIGTERM',
  )();

  assert.deepEqual(
    signals,
    ['SIGTERM'],
  );
  assert.deepEqual(
    exits,
    [0],
  );
});

test('process shutdown handlers log failure and exit nonzero', async () => {
  const handlers = new Map();
  const exits = [];
  const logs = [];

  installProcessShutdownHandlers({
    async shutdown() {
      const error =
        new Error(
          'close failed',
        );
      error.code = 'ECLOSE';
      throw error;
    },
    processRuntime: {
      once(signal, handler) {
        handlers.set(
          signal,
          handler,
        );
      },
      exit(code) {
        exits.push(code);
      },
    },
    log(
      level,
      event,
      details,
    ) {
      logs.push({
        level,
        event,
        details,
      });
    },
  });

  await handlers.get(
    'SIGINT',
  )();

  assert.deepEqual(
    exits,
    [1],
  );
  assert.equal(
    logs.length,
    1,
  );
  assert.equal(
    logs[0].level,
    'error',
  );
  assert.equal(
    logs[0].event,
    'shutdown:error',
  );
  assert.equal(
    logs[0].details.signal,
    'SIGINT',
  );
  assert.equal(
    logs[0].details.code,
    'ECLOSE',
  );
  assert.equal(
    logs[0].details.message,
    'close failed',
  );
});
