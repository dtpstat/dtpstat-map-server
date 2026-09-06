import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { attachPoolErrorHandlers } from '../src/db/pool.js';

test('unexpected pooled client errors are handled without crashing the process', () => {
  const pool = new EventEmitter();
  const client = new EventEmitter();
  client.processID = 4242;
  const logs = [];

  attachPoolErrorHandlers(
    pool,
    'tramlanes',
    (message, details) => logs.push({ message, details }),
  );
  pool.emit('connect', client);

  const terminated = new Error('Connection terminated unexpectedly');
  terminated.code = '57P01';

  assert.doesNotThrow(() => client.emit('error', terminated));
  // pg may forward the same idle-client error through Pool#error. It must be
  // reported only once and, most importantly, remain a handled event.
  assert.doesNotThrow(() => pool.emit('error', terminated, client));

  assert.deepEqual(logs, [
    {
      message: 'Unexpected PostgreSQL connection error',
      details: {
        schema: 'tramlanes',
        processId: 4242,
        name: 'Error',
        code: '57P01',
        message: 'Connection terminated unexpectedly',
      },
    },
  ]);

  const idleFailure = new Error('server closed the connection unexpectedly');
  assert.doesNotThrow(() => pool.emit('error', idleFailure, client));
  assert.equal(logs.length, 2);
});
