import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createAdminNotificationChannel,
  normalizeAdminNotification,
} from '../src/modules/notifications/channel.js';

test('admin notification domain normalizes safe levels persistence delivery and controls', () => {
  const event =
    normalizeAdminNotification(
      {
        level: 'warn',
        message:
          '  Role changed  ',
        permission:
          'geometry-editor',
        timeoutMs: 2_000,
        audience: {
          userIds:
            [7, 7, -1, '8'],
          sessionIds:
            [12],
          excludeSessionIds:
            [13],
        },
        control: {
          action:
            'refresh-session',
          reason:
            'role-change',
        },
        source: {
          kind:
            'security-user',
          id: 7,
          ignored:
            'not transported',
        },
      },
      {
        randomUUID:
          () => 'notification-1',
        now:
          () =>
            '2026-09-29T01:00:00.000Z',
      },
    );

  assert.deepEqual(
    event,
    {
      type:
        'notification',
      notification: {
        id:
          'notification-1',
        level:
          'warn',
        message:
          'Role changed',
        persistent:
          true,
        timeoutMs:
          0,
        createdAt:
          '2026-09-29T01:00:00.000Z',
        code:
          null,
        control: {
          action:
            'refresh-session',
          reason:
            'role-change',
        },
        source: {
          kind:
            'security-user',
          id:
            '7',
        },
      },
      delivery: {
        permission:
          'geometry-editor',
        audience: {
          userIds:
            [7, 8],
          sessionIds:
            [12],
          excludeSessionIds:
            [13],
        },
      },
    },
  );

  assert.throws(
    () =>
      normalizeAdminNotification({
        level:
          'success',
        message:
          'unsupported',
      }),
    /Unsupported notification level/u,
  );
  assert.throws(
    () =>
      normalizeAdminNotification({
        level:
          'info',
        message:
          'bad control',
        control: {
          action:
            'execute-script',
        },
      }),
    /Unsupported notification control action/u,
  );

  assert.throws(
    () =>
      normalizeAdminNotification({
        level:
          'info',
        message:
          'bad permission',
        permission:
          'unknown-capability',
      }),
    /Unsupported notification permission/u,
  );
});

test('admin notification channel is a focused publish subscribe boundary', () => {
  const events = [];
  const channel =
    createAdminNotificationChannel({
      randomUUID:
        () => 'notification-2',
      now:
        () =>
          '2026-09-29T01:01:00.000Z',
    });

  const unsubscribe =
    channel.subscribe(
      (event) =>
        events.push(event),
    );

  const published =
    channel.publish({
      level: 'info',
      message: 'Updated',
    });

  assert.equal(
    published.id,
    'notification-2',
  );
  assert.equal(
    published.timeoutMs,
    5_000,
  );
  assert.equal(
    events.length,
    1,
  );

  unsubscribe();
  channel.publish({
    level: 'log',
    message:
      'not observed',
  });
  assert.equal(
    events.length,
    1,
  );
});
