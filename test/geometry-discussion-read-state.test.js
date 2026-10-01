import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  createGeometryDiscussionStorage,
} from '../src/db/geometry-discussion-storage.js';

test('V062 persists one read position per geometry and user', async () => {
  const sql =
    await readFile(
      new URL(
        '../db/migrations/V062__geometry_discussion_read_state.sql',
        import.meta.url,
      ),
      'utf8',
    );

  assert.match(
    sql,
    /CREATE TABLE IF NOT EXISTS BUSLANES\.GEOMETRY_DISCUSSION_READ_STATE/u,
  );
  assert.match(
    sql,
    /PRIMARY KEY \(GEOMETRY_ID, USER_ID\)/u,
  );
  assert.match(
    sql,
    /LAST_READ_MESSAGE_ID[\s\S]*REFERENCES BUSLANES\.GEOMETRY_DISCUSSION_MESSAGES \(ID\)/u,
  );
  assert.match(
    sql,
    /REFERENCES BUSLANES\.CITY_GEOMETRIES \(ID\)[\s\S]*ON DELETE CASCADE/u,
  );
  assert.match(
    sql,
    /REFERENCES BUSLANES\.ADMIN_USERS \(ID\)[\s\S]*ON DELETE CASCADE/u,
  );
});

test('geometry discussion storage excludes own messages from unread and exposes read receipts', async () => {
  const calls = [];
  const database = {
    async query(text, values = []) {
      calls.push({
        text,
        values,
      });

      if (
        text.includes(
          'COUNT(*)::integer AS "unreadCount"',
        )
      ) {
        return {
          rows: [{
            geometryId: 9,
            unreadCount: 2,
          }],
        };
      }

      if (
        text.includes(
          'ORDER BY message.id DESC',
        )
      ) {
        return {
          rows: [{
            id: 5,
            geometryId: 9,
            authorUserId: 10,
            authorDisplayName: 'User',
            authorUsername: 'user',
            authorHasAvatar: false,
            geometryRevision: null,
            message: 'Hello',
            createdAt:
              '2026-10-01T10:00:00.000Z',
            editedAt: null,
            readByOthersCount: 1,
          }],
        };
      }

      return {
        rows: [],
      };
    },
  };

  const storage =
    createGeometryDiscussionStorage(
      database,
    );

  assert.deepEqual(
    await storage.unreadCounts(77),
    [{
      geometryId: 9,
      unreadCount: 2,
    }],
  );

  const unreadSql =
    calls[0].text;
  assert.match(
    unreadSql,
    /message\.author_user_id IS DISTINCT FROM \$1::bigint/u,
  );
  assert.match(
    unreadSql,
    /message\.id > read_state\.last_read_message_id/u,
  );

  const messages =
    await storage.listMessages(
      9,
    );
  assert.equal(
    messages[0]
      .readByOthersCount,
    1,
  );
  assert.match(
    calls[1].text,
    /read_state\.last_read_message_id >= message\.id/u,
  );
});

test('geometry discussion read marker advances atomically to a message from the same geometry', async () => {
  const calls = [];
  const client = {
    async query(text, values) {
      calls.push({
        text,
        values,
      });
      return {
        rows: [{
          geometryId: 9,
          userId: 77,
          lastReadMessageId: 15,
          updatedAt:
            '2026-10-01T10:30:00.000Z',
        }],
      };
    },
  };
  const storage =
    createGeometryDiscussionStorage({
      async query() {
        return {
          rows: [],
        };
      },
    });

  const read =
    await storage.markRead(
      client,
      {
        geometryId: 9,
        userId: 77,
        messageId: 15,
      },
    );

  assert.equal(
    read.lastReadMessageId,
    15,
  );
  assert.deepEqual(
    calls[0].values,
    [9, 77, 15],
  );
  assert.match(
    calls[0].text,
    /message\.geometry_id = \$1::bigint/u,
  );
  assert.match(
    calls[0].text,
    /ON CONFLICT \(geometry_id, user_id\)/u,
  );
  assert.match(
    calls[0].text,
    /GREATEST\(/u,
  );
});
