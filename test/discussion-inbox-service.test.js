import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDiscussionInboxService,
} from '../src/modules/discussions/inbox-service.js';

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
