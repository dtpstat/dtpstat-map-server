import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createNotificationPool,
} from '../admin/notification-center.js';

test('client notification pool supports multiple typed dismissible notifications', async () => {
  let nextId = 0;
  const events = [];
  const pool =
    createNotificationPool({
      randomUUID:
        () =>
          'client-' +
          (++nextId),
      now:
        () =>
          '2026-09-29T01:10:00.000Z',
      maxSize: 4,
    });

  pool.subscribe(
    (event) =>
      events.push(event),
    {
      replay: false,
    },
  );

  const info =
    pool.publish({
      level: 'info',
      message: 'Info',
    });
  const log =
    pool.publish({
      level: 'log',
      message: 'Log',
    });
  const warn =
    pool.publish({
      level: 'warn',
      message: 'Warn',
      timeoutMs: 2_000,
    });
  const error =
    pool.publish({
      level: 'error',
      message: 'Error',
      persistent: false,
    });

  assert.equal(
    info.timeoutMs,
    5_000,
  );
  assert.equal(
    log.timeoutMs,
    4_000,
  );
  assert.equal(
    warn.persistent,
    true,
  );
  assert.equal(
    warn.timeoutMs,
    0,
  );
  assert.equal(
    error.persistent,
    true,
  );
  assert.equal(
    pool.snapshot().length,
    4,
  );

  assert.equal(
    pool.dismiss(
      warn.id,
    ),
    true,
  );
  assert.equal(
    pool.snapshot().length,
    3,
  );
  assert.equal(
    events.at(-1).kind,
    'dismissed',
  );
});
