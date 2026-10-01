import {
  createDiscussionStorage,
} from './discussion-storage.js';

const SUBJECT_TYPE =
  'geometry';

function geometryMessage(
  message,
) {
  if (!message) return null;

  return {
    id:
      message.id,
    geometryId:
      message.subjectId,
    authorUserId:
      message.authorUserId,
    authorDisplayName:
      message.authorDisplayName,
    authorUsername:
      message.authorUsername,
    authorHasAvatar:
      message.authorHasAvatar,
    geometryRevision:
      message.subjectRevision,
    message:
      message.message,
    createdAt:
      message.createdAt,
    editedAt:
      message.editedAt,
    readByOthersCount:
      message.readByOthersCount,
  };
}

export function createGeometryDiscussionStorage(
  database,
) {
  const discussions =
    createDiscussionStorage(
      database,
    );

  return {
    async geometryExists(
      geometryId,
      queryable = database,
    ) {
      const result =
        await queryable.query(
          'SELECT 1 FROM city_geometries WHERE id = $1::bigint',
          [geometryId],
        );

      return Boolean(
        result.rows[0],
      );
    },

    async listMessages(
      geometryId,
      limit = 200,
    ) {
      const messages =
        await discussions
          .listMessages(
            SUBJECT_TYPE,
            geometryId,
            limit,
          );

      return messages.map(
        geometryMessage,
      );
    },

    async unreadCounts(
      userId,
    ) {
      const items =
        await discussions
          .unreadCounts(
            userId,
            [SUBJECT_TYPE],
          );

      return items.map(
        (item) => ({
          geometryId:
            item.subjectId,
          unreadCount:
            item.unreadCount,
        }),
      );
    },

    async markRead(
      client,
      {
        geometryId,
        userId,
        messageId,
      },
    ) {
      const result =
        await discussions
          .markRead(
            client,
            {
              subjectType:
                SUBJECT_TYPE,
              subjectId:
                geometryId,
              userId,
              messageId,
            },
          );

      if (!result) {
        return null;
      }

      return {
        geometryId:
          result.subjectId,
        userId:
          result.userId,
        lastReadMessageId:
          result.lastReadMessageId,
        updatedAt:
          result.updatedAt,
      };
    },

    latestMessageId(
      geometryId,
      queryable = database,
    ) {
      return discussions
        .latestMessageId(
          SUBJECT_TYPE,
          geometryId,
          queryable,
        );
    },

    async createMessage(
      client,
      {
        geometryId,
        authorUserId,
        message,
      },
    ) {
      const geometry =
        await client.query(
          `SELECT
             id::integer AS id,
             updated_at AS "updatedAt"
           FROM city_geometries
           WHERE id = $1::bigint`,
          [geometryId],
        );

      const subject =
        geometry.rows[0];

      if (!subject) {
        return null;
      }

      return geometryMessage(
        await discussions
          .createMessage(
            client,
            {
              subjectType:
                SUBJECT_TYPE,
              subjectId:
                geometryId,
              authorUserId,
              subjectRevision:
                subject.updatedAt,
              message,
            },
          ),
      );
    },
  };
}
