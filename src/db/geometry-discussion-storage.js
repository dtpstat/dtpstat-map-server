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
  message.edited_at AS "editedAt"
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
