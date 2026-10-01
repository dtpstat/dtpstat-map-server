import {
  createDiscussionStorage,
} from './discussion-storage.js';

const SUBJECT_TYPE =
  'osm-boundary';

function boundaryMessage(
  message,
) {
  if (!message) return null;

  return {
    id:
      message.id,
    boundaryId:
      message.subjectId,
    authorUserId:
      message.authorUserId,
    authorDisplayName:
      message.authorDisplayName,
    authorUsername:
      message.authorUsername,
    authorHasAvatar:
      message.authorHasAvatar,
    boundaryRevision:
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

export function createOsmDiscussionStorage(
  database,
) {
  const discussions =
    createDiscussionStorage(
      database,
    );

  return {
    async boundaryExists(
      boundaryId,
      queryable = database,
    ) {
      const result =
        await queryable.query(
          'SELECT 1 FROM city_boundaries WHERE id = $1::bigint',
          [boundaryId],
        );

      return Boolean(
        result.rows[0],
      );
    },

    async listMessages(
      boundaryId,
      limit = 200,
    ) {
      const messages =
        await discussions
          .listMessages(
            SUBJECT_TYPE,
            boundaryId,
            limit,
          );

      return messages.map(
        boundaryMessage,
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
          boundaryId:
            item.subjectId,
          unreadCount:
            item.unreadCount,
        }),
      );
    },

    async markRead(
      client,
      {
        boundaryId,
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
                boundaryId,
              userId,
              messageId,
            },
          );

      if (!result) {
        return null;
      }

      return {
        boundaryId:
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
      boundaryId,
      queryable = database,
    ) {
      return discussions
        .latestMessageId(
          SUBJECT_TYPE,
          boundaryId,
          queryable,
        );
    },

    async createMessage(
      client,
      {
        boundaryId,
        authorUserId,
        message,
      },
    ) {
      const boundary =
        await client.query(
          `SELECT
             id::integer AS id,
             updated_at AS "updatedAt"
           FROM city_boundaries
           WHERE id = $1::bigint`,
          [boundaryId],
        );

      const subject =
        boundary.rows[0];

      if (!subject) {
        return null;
      }

      return boundaryMessage(
        await discussions
          .createMessage(
            client,
            {
              subjectType:
                SUBJECT_TYPE,
              subjectId:
                boundaryId,
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
