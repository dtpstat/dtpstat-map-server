const MESSAGE_COLUMNS_SQL = `
  message.id::integer AS id,
  message.geometry_id::integer AS "geometryId",
  message.author_user_id::integer AS "authorUserId",
  COALESCE(
    NULLIF(BTRIM(author.display_name), ''),
    author.username,
    'Удалённый пользователь'
  ) AS "authorDisplayName",
  author.username AS "authorUsername",
  (author.avatar_data IS NOT NULL) AS "authorHasAvatar",
  message.geometry_revision AS "geometryRevision",
  message.message,
  message.created_at AS "createdAt",
  message.edited_at AS "editedAt",
  (
    SELECT COUNT(*)::integer
    FROM geometry_discussion_read_state AS read_state
    WHERE read_state.geometry_id = message.geometry_id
      AND read_state.user_id <> message.author_user_id
      AND read_state.last_read_message_id IS NOT NULL
      AND read_state.last_read_message_id >= message.id
  ) AS "readByOthersCount"
`;

const MESSAGE_BY_ID_SQL = `
  SELECT
    ${MESSAGE_COLUMNS_SQL}
  FROM geometry_discussion_messages AS message
  LEFT JOIN admin_users AS author
    ON author.id = message.author_user_id
  WHERE message.id = $1::bigint
    AND message.deleted_at IS NULL
`;

export function createGeometryDiscussionStorage(
  database,
) {
  async function one(
    queryable,
    messageId,
  ) {
    const result =
      await queryable.query(
        MESSAGE_BY_ID_SQL,
        [messageId],
      );

    return result.rows[0] ?? null;
  }

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
      const result =
        await database.query(
          `SELECT
             ${MESSAGE_COLUMNS_SQL}
           FROM geometry_discussion_messages AS message
           LEFT JOIN admin_users AS author
             ON author.id = message.author_user_id
           WHERE message.geometry_id = $1::bigint
             AND message.deleted_at IS NULL
           ORDER BY message.id DESC
           LIMIT $2::integer`,
          [
            geometryId,
            limit,
          ],
        );

      return result.rows.reverse();
    },

    async unreadCounts(
      userId,
    ) {
      const result =
        await database.query(
          `SELECT
             message.geometry_id::integer AS "geometryId",
             COUNT(*)::integer AS "unreadCount"
           FROM geometry_discussion_messages AS message
           LEFT JOIN geometry_discussion_read_state AS read_state
             ON read_state.geometry_id = message.geometry_id
            AND read_state.user_id = $1::bigint
           WHERE message.deleted_at IS NULL
             AND message.author_user_id IS DISTINCT FROM $1::bigint
             AND (
               read_state.last_read_message_id IS NULL
               OR message.id > read_state.last_read_message_id
             )
           GROUP BY message.geometry_id
           ORDER BY message.geometry_id`,
          [userId],
        );

      return result.rows;
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
        await client.query(
          `INSERT INTO geometry_discussion_read_state (
             geometry_id,
             user_id,
             last_read_message_id,
             updated_at
           )
           SELECT
             $1::bigint,
             $2::bigint,
             message.id,
             NOW()
           FROM geometry_discussion_messages AS message
           WHERE message.id = $3::bigint
             AND message.geometry_id = $1::bigint
             AND message.deleted_at IS NULL
           ON CONFLICT (geometry_id, user_id)
           DO UPDATE SET
             last_read_message_id =
               GREATEST(
                 geometry_discussion_read_state.last_read_message_id,
                 EXCLUDED.last_read_message_id
               ),
             updated_at = NOW()
           RETURNING
             geometry_id::integer AS "geometryId",
             user_id::integer AS "userId",
             last_read_message_id::integer AS "lastReadMessageId",
             updated_at AS "updatedAt"`,
          [
            geometryId,
            userId,
            messageId,
          ],
        );

      return result.rows[0] ?? null;
    },

    async latestMessageId(
      geometryId,
      queryable = database,
    ) {
      const result =
        await queryable.query(
          `SELECT MAX(id)::integer AS id
           FROM geometry_discussion_messages
           WHERE geometry_id = $1::bigint
             AND deleted_at IS NULL`,
          [geometryId],
        );

      return result.rows[0]?.id ?? null;
    },

    async createMessage(
      client,
      {
        geometryId,
        authorUserId,
        message,
      },
    ) {
      const result =
        await client.query(
          `INSERT INTO geometry_discussion_messages (
             geometry_id,
             author_user_id,
             geometry_revision,
             message
           )
           SELECT
             geometry.id,
             $2::bigint,
             geometry.updated_at,
             $3::text
           FROM city_geometries AS geometry
           WHERE geometry.id = $1::bigint
           RETURNING id::integer AS id`,
          [
            geometryId,
            authorUserId,
            message,
          ],
        );

      const id =
        result.rows[0]?.id;

      return id
        ? one(
          client,
          id,
        )
        : null;
    },
  };
}
