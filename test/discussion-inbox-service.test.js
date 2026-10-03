import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDiscussionInboxService,
} from '../src/modules/discussions/inbox-service.js';
import {
  publishDiscussionNotifications,
} from '../src/modules/discussions/notifications.js';

test('discussion inbox filters subjects by current admin capabilities and sums unread', async () => {
  const calls = [];
  const storage = {
    async listInbox(userId, subjectTypes) {
      calls.push({
        userId,
        subjectTypes,
      });
      return [
        {
          subjectType: 'geometry',
          subjectId: 10,
          subjectTitle: 'Линия',
          subjectSubtitle: 'Геометрия #10',
          subjectExists: true,
          latestMessageId: 5,
          latestMessage: 'Проверил',
          latestCreatedAt: '2026-10-01T12:00:00.000Z',
          latestAuthorUserId: 2,
          latestAuthorUsername: 'alex',
          latestAuthorDisplayName: 'Алексей',
          latestAuthorHasAvatar: true,
          latestAuthorUpdatedAt: '2026-10-01T11:00:00.000Z',
          unreadCount: 3,
        },
      ];
    },
  };

  const service =
    createDiscussionInboxService(storage);

  const result =
    await service.listInbox({
      id: 7,
      canEditGeometries: true,
      canEditOsm: false,
      isSuperuser: false,
    });

  assert.deepEqual(
    calls,
    [{
      userId: 7,
      subjectTypes: ['geometry'],
    }],
  );
  assert.equal(
    result.totalUnread,
    3,
  );
  assert.equal(
    result.items[0]
      .latestAuthor
      .avatarUrl,
    '/api/admin/geometry-editor/users/2/avatar?v=2026-10-01T11%3A00%3A00.000Z',
  );
});

test('discussion inbox returns empty without discussion permissions', async () => {
  let called = false;
  const service =
    createDiscussionInboxService({
      async listInbox() {
        called = true;
        return [];
      },
    });

  assert.deepEqual(
    await service.listInbox({
      id: 9,
    }),
    {
      items: [],
      totalUnread: 0,
    },
  );
  assert.equal(
    called,
    false,
  );
});

test('superuser discussion inbox can see geometry and OSM subjects', async () => {
  let subjectTypes = null;
  const service =
    createDiscussionInboxService({
      async listInbox(
        _userId,
        types,
      ) {
        subjectTypes =
          types;
        return [];
      },
    });

  await service.listInbox({
    id: 1,
    isSuperuser: true,
  });

  assert.deepEqual(
    subjectTypes,
    [
      'geometry',
      'osm-boundary',
    ],
  );
});


test('discussion read-all stays inside current discussion capabilities', async () => {
  const calls = [];
  const service =
    createDiscussionInboxService({
      async markAllRead(
        userId,
        subjectTypes,
      ) {
        calls.push({
          userId,
          subjectTypes,
        });
        return [{
          subjectType:
            'geometry',
          subjectId: 10,
          lastReadMessageId: 8,
        }];
      },
    });

  const result =
    await service.markAllRead({
      id: 7,
      canEditGeometries: true,
      canEditOsm: false,
    });

  assert.deepEqual(
    calls,
    [{
      userId: 7,
      subjectTypes:
        ['geometry'],
    }],
  );
  assert.equal(
    result.items[0]
      .lastReadMessageId,
    8,
  );
});

test('discussion notification targets parse unique mentions and honor subject permissions', async () => {
  const calls = [];
  const service =
    createDiscussionInboxService({
      async notificationTargets(
        subjectType,
        subjectId,
        authorUserId,
        mentionLogins,
      ) {
        calls.push({
          subjectType,
          subjectId,
          authorUserId,
          mentionLogins,
        });
        return {
          subject: {
            title: 'Линия',
          },
          participantUserIds:
            [2],
          mentionedUsers: [{
            userId: 3,
            username: 'alex',
          }],
        };
      },
    });

  const targets =
    await service
      .notificationTargets(
        {
          id: 7,
          canEditGeometries:
            true,
        },
        {
          subjectType:
            'geometry',
          subjectId: 10,
          message:
            'Проверь @Alex и ещё раз @alex, плюс @user.name',
        },
      );

  assert.deepEqual(
    calls,
    [{
      subjectType:
        'geometry',
      subjectId: 10,
      authorUserId: 7,
      mentionLogins: [
        'alex',
        'user.name',
      ],
    }],
  );
  assert.deepEqual(
    targets.mentionedUsers,
    [{
      userId: 3,
      username: 'alex',
    }],
  );

  assert.deepEqual(
    await service
      .notificationTargets(
        {
          id: 7,
          canEditGeometries:
            true,
          canEditOsm:
            false,
        },
        {
          subjectType:
            'osm-boundary',
          subjectId: 5,
          message: '@alex',
        },
      ),
    {
      subject: null,
      participantUserIds: [],
      mentionedUsers: [],
    },
  );
  assert.equal(
    calls.length,
    1,
  );
});


test('discussion notifications separate participants from accented mentions', () => {
  const events = [];
  const result =
    publishDiscussionNotifications(
      {
        publish(event) {
          events.push(event);
          return event;
        },
      },
      {
        permission:
          'geometry-editor',
        actor: {
          id: 7,
          username:
            'operator',
          displayName:
            'Оператор',
        },
        subjectType:
          'geometry',
        subjectId: 862,
        targets: {
          subject: {
            title:
              'Крымская',
          },
          participantUserIds:
            [2, 3, 4],
          mentionedUsers: [
            {
              userId: 3,
              username:
                'alex',
            },
            {
              userId: 5,
              username:
                'user5',
            },
          ],
        },
      },
    );

  assert.deepEqual(
    result,
    {
      participantCount: 2,
      mentionCount: 2,
    },
  );
  assert.equal(
    events.length,
    2,
  );

  const ordinary =
    events.find(
      (event) =>
        event.code ===
        'discussion-message',
    );
  const mention =
    events.find(
      (event) =>
        event.code ===
        'discussion-mention',
    );

  assert.deepEqual(
    ordinary.audience.userIds,
    [2, 4],
  );
  assert.deepEqual(
    mention.audience.userIds,
    [3, 5],
  );
  assert.deepEqual(
    mention.source,
    {
      kind:
        'discussion-thread',
      id:
        'geometry:862',
    },
  );
  assert.match(
    mention.message,
    /упомянул вас/u,
  );
  assert.ok(
    mention.timeoutMs >
      ordinary.timeoutMs,
  );
});
