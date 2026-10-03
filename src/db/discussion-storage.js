const MESSAGE_COLUMNS_SQL = `
  message.id::integer AS id,
  message.subject_type AS "subjectType",
  message.subject_id::integer AS "subjectId",
  message.author_user_id::integer AS "authorUserId",
  COALESCE(
    NULLIF(BTRIM(author.display_name), ''),
    author.username,
    'Удалённый пользователь'
  ) AS "authorDisplayName",
  author.username AS "authorUsername",
  (author.avatar_data IS NOT NULL) AS "authorHasAvatar",
  message.subject_revision AS "subjectRevision",
  message.message,
  message.created_at AS "createdAt",
  message.edited_at AS "editedAt",
  (
    SELECT COUNT(*)::integer
    FROM admin_discussion_read_state AS read_state
    WHERE read_state.subject_type = message.subject_type
      AND read_state.subject_id = message.subject_id
      AND read_state.user_id <> message.author_user_id
      AND read_state.last_read_message_id IS NOT NULL
      AND read_state.last_read_message_id >= message.id
  ) AS "readByOthersCount"
`;

const MESSAGE_BY_ID_SQL = `
  SELECT
    ${MESSAGE_COLUMNS_SQL}
  FROM admin_discussion_messages AS message
  LEFT JOIN admin_users AS author
    ON author.id = message.author_user_id
  WHERE message.id = $1::bigint
    AND message.deleted_at IS NULL
`;

export function createDiscussionStorage(
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
    async getSubject(
      subjectType,
      subjectId,
      queryable = database,
    ) {
      const result =
        await queryable.query(
          `SELECT
             $1::text AS "subjectType",
             $2::bigint::integer AS "subjectId",
             CASE
               WHEN $1::text = 'geometry'
                 THEN geometry.display_name
               WHEN $1::text = 'osm-boundary'
                 THEN COALESCE(
                   boundary.display_name,
                   boundary.osm_name
                 )
               ELSE NULL
             END AS "title",
             CASE
               WHEN $1::text = 'geometry'
                 THEN 'Геометрия #' || $2::bigint::text
               WHEN $1::text = 'osm-boundary'
                 THEN boundary.osm_type || '/' || boundary.osm_id::text
               ELSE NULL
             END AS "subtitle",
             CASE
               WHEN $1::text = 'geometry'
                 THEN geometry.updated_at
               WHEN $1::text = 'osm-boundary'
                 THEN boundary.updated_at
               ELSE NULL
             END AS "subjectRevision"
           FROM (SELECT 1) AS seed
           LEFT JOIN city_geometries AS geometry
             ON $1::text = 'geometry'
            AND geometry.id = $2::bigint
           LEFT JOIN city_boundaries AS boundary
             ON $1::text = 'osm-boundary'
            AND boundary.id = $2::bigint
           WHERE
             ($1::text = 'geometry' AND geometry.id IS NOT NULL)
             OR
             ($1::text = 'osm-boundary' AND boundary.id IS NOT NULL)`,
          [
            subjectType,
            subjectId,
          ],
        );

      return result.rows[0] ?? null;
    },

    async listInbox(
      userId,
      subjectTypes,
      limit = 200,
    ) {
      const result =
        await database.query(
          `WITH latest AS (
             SELECT DISTINCT ON (
               message.subject_type,
               message.subject_id
             )
               message.subject_type,
               message.subject_id,
               message.id,
               message.author_user_id,
               message.message,
               message.created_at
             FROM admin_discussion_messages AS message
             WHERE message.deleted_at IS NULL
               AND message.subject_type = ANY($2::text[])
             ORDER BY
               message.subject_type,
               message.subject_id,
               message.id DESC
           )
           SELECT
             latest.subject_type AS "subjectType",
             latest.subject_id::integer AS "subjectId",
             latest.id::integer AS "latestMessageId",
             latest.message AS "latestMessage",
             latest.created_at AS "latestCreatedAt",
             latest.author_user_id::integer AS "latestAuthorUserId",
             COALESCE(
               NULLIF(BTRIM(author.display_name), ''),
               author.username,
               'Удалённый пользователь'
             ) AS "latestAuthorDisplayName",
             author.username AS "latestAuthorUsername",
             (author.avatar_data IS NOT NULL) AS "latestAuthorHasAvatar",
             author.updated_at AS "latestAuthorUpdatedAt",
             CASE
               WHEN latest.subject_type = 'geometry'
                 THEN COALESCE(
                   NULLIF(BTRIM(geometry.display_name), ''),
                   'Геометрия #' || latest.subject_id::text
                 )
               WHEN latest.subject_type = 'osm-boundary'
                 THEN COALESCE(
                   NULLIF(BTRIM(boundary.display_name), ''),
                   NULLIF(BTRIM(boundary.osm_name), ''),
                   'OSM-объект #' || latest.subject_id::text
                 )
             END AS "subjectTitle",
             CASE
               WHEN latest.subject_type = 'geometry'
                 THEN 'Геометрия #' || latest.subject_id::text
               WHEN latest.subject_type = 'osm-boundary'
                 THEN boundary.osm_type || '/' || boundary.osm_id::text
             END AS "subjectSubtitle",
             (
               CASE
                 WHEN latest.subject_type = 'geometry'
                   THEN geometry.id IS NOT NULL
                 WHEN latest.subject_type = 'osm-boundary'
                   THEN boundary.id IS NOT NULL
                 ELSE FALSE
               END
             ) AS "subjectExists",
             CASE
               WHEN latest.subject_type = 'geometry'
                 THEN geometry.city_id::integer
               ELSE NULL
             END AS "subjectCityId",
             (
               SELECT COUNT(*)::integer
               FROM admin_discussion_messages AS unread
               LEFT JOIN admin_discussion_read_state AS read_state
                 ON read_state.subject_type = unread.subject_type
                AND read_state.subject_id = unread.subject_id
                AND read_state.user_id = $1::bigint
               WHERE unread.subject_type = latest.subject_type
                 AND unread.subject_id = latest.subject_id
                 AND unread.deleted_at IS NULL
                 AND unread.author_user_id IS DISTINCT FROM $1::bigint
                 AND (
                   read_state.last_read_message_id IS NULL
                   OR unread.id > read_state.last_read_message_id
                 )
             ) AS "unreadCount"
           FROM latest
           LEFT JOIN admin_users AS author
             ON author.id = latest.author_user_id
           LEFT JOIN city_geometries AS geometry
             ON latest.subject_type = 'geometry'
            AND geometry.id = latest.subject_id
           LEFT JOIN city_boundaries AS boundary
             ON latest.subject_type = 'osm-boundary'
            AND boundary.id = latest.subject_id
           ORDER BY latest.id DESC
           LIMIT $3::integer`,
          [
            userId,
            subjectTypes,
            limit,
          ],
        );

      return result.rows;
    },

    async listMessages(
      subjectType,
      subjectId,
      limit = 200,
    ) {
      const result =
        await database.query(
          `SELECT
             ${MESSAGE_COLUMNS_SQL}
           FROM admin_discussion_messages AS message
           LEFT JOIN admin_users AS author
             ON author.id = message.author_user_id
           WHERE message.subject_type = $1::text
             AND message.subject_id = $2::bigint
             AND message.deleted_at IS NULL
           ORDER BY message.id DESC
           LIMIT $3::integer`,
          [
            subjectType,
            subjectId,
            limit,
          ],
        );

      return result.rows.reverse();
    },

    async unreadCounts(
      userId,
      subjectTypes,
    ) {
      const result =
        await database.query(
          `SELECT
             message.subject_type AS "subjectType",
             message.subject_id::integer AS "subjectId",
             COUNT(*)::integer AS "unreadCount"
           FROM admin_discussion_messages AS message
           LEFT JOIN admin_discussion_read_state AS read_state
             ON read_state.subject_type = message.subject_type
            AND read_state.subject_id = message.subject_id
            AND read_state.user_id = $1::bigint
           WHERE message.deleted_at IS NULL
             AND message.author_user_id IS DISTINCT FROM $1::bigint
             AND message.subject_type = ANY($2::text[])
             AND (
               read_state.last_read_message_id IS NULL
               OR message.id > read_state.last_read_message_id
             )
           GROUP BY
             message.subject_type,
             message.subject_id
           ORDER BY
             message.subject_type,
             message.subject_id`,
          [
            userId,
            subjectTypes,
          ],
        );

      return result.rows;
    },

    async threadStates(
      userId,
      subjectTypes,
    ) {
      const result =
        await database.query(
          `SELECT
             message.subject_type AS "subjectType",
             message.subject_id::integer AS "subjectId",
             COUNT(*)::integer AS "messageCount",
             COUNT(*) FILTER (
               WHERE
                 message.author_user_id IS DISTINCT FROM $1::bigint
                 AND (
                   read_state.last_read_message_id IS NULL
                   OR message.id > read_state.last_read_message_id
                 )
             )::integer AS "unreadCount"
           FROM admin_discussion_messages AS message
           LEFT JOIN admin_discussion_read_state AS read_state
             ON read_state.subject_type = message.subject_type
            AND read_state.subject_id = message.subject_id
            AND read_state.user_id = $1::bigint
           WHERE message.deleted_at IS NULL
             AND message.subject_type = ANY($2::text[])
           GROUP BY
             message.subject_type,
             message.subject_id
           ORDER BY
             message.subject_type,
             message.subject_id`,
          [
            userId,
            subjectTypes,
          ],
        );

      return result.rows;
    },

    async mentionSuggestions(
      subjectType,
      query,
      limit = 8,
    ) {
      const permissionColumn =
        subjectType ===
        'geometry'
          ? 'can_edit_geometries'
          : subjectType ===
            'osm-boundary'
            ? 'can_edit_osm'
            : null;

      if (!permissionColumn) {
        return [];
      }

      const result =
        await database.query(
          `SELECT
             id::integer AS "userId",
             username,
             display_name AS "displayName"
           FROM admin_users
           WHERE (
               is_superuser = TRUE
               OR ${permissionColumn} = TRUE
             )
             AND is_blocked = FALSE
             AND LOWER(username) LIKE LOWER($1::text) || '%'
           ORDER BY
             LOWER(username),
             id
           LIMIT $2::integer`,
          [
            query,
            limit,
          ],
        );

      return result.rows;
    },

    async notificationTargets(
      subjectType,
      subjectId,
      authorUserId,
      mentionLogins = [],
    ) {
      const [
        subject,
        participants,
        mentionedUsers,
      ] =
        await Promise.all([
          this.getSubject(
            subjectType,
            subjectId,
          ),
          database.query(
            `SELECT DISTINCT
               message.author_user_id::integer AS "userId"
             FROM admin_discussion_messages AS message
             WHERE message.subject_type = $1::text
               AND message.subject_id = $2::bigint
               AND message.deleted_at IS NULL
               AND message.author_user_id IS NOT NULL
               AND message.author_user_id <> $3::bigint
             ORDER BY "userId"`,
            [
              subjectType,
              subjectId,
              authorUserId,
            ],
          ),
          mentionLogins.length
            ? database.query(
              `SELECT
                 id::integer AS "userId",
                 username
               FROM admin_users
               WHERE LOWER(username) = ANY($1::text[])
                 AND id <> $2::bigint
               ORDER BY id`,
              [
                mentionLogins,
                authorUserId,
              ],
            )
            : Promise.resolve({
              rows: [],
            }),
        ]);

      return {
        subject,
        participantUserIds:
          participants.rows.map(
            (row) => row.userId,
          ),
        mentionedUsers:
          mentionedUsers.rows,
      };
    },

    async markAllRead(
      userId,
      subjectTypes,
    ) {
      const result =
        await database.query(
          `INSERT INTO admin_discussion_read_state (
             subject_type,
             subject_id,
             user_id,
             last_read_message_id,
             updated_at
           )
           SELECT
             message.subject_type,
             message.subject_id,
             $1::bigint,
             MAX(message.id),
             NOW()
           FROM admin_discussion_messages AS message
           WHERE message.deleted_at IS NULL
             AND message.subject_type = ANY($2::text[])
           GROUP BY
             message.subject_type,
             message.subject_id
           ON CONFLICT (
             subject_type,
             subject_id,
             user_id
           )
           DO UPDATE SET
             last_read_message_id =
               GREATEST(
                 COALESCE(
                   admin_discussion_read_state.last_read_message_id,
                   0
                 ),
                 EXCLUDED.last_read_message_id
               ),
             updated_at = NOW()
           RETURNING
             subject_type AS "subjectType",
             subject_id::integer AS "subjectId",
             last_read_message_id::integer AS "lastReadMessageId"`,
          [
            userId,
            subjectTypes,
          ],
        );

      return result.rows;
    },

    async markRead(
      client,
      {
        subjectType,
        subjectId,
        userId,
        messageId,
      },
    ) {
      const result =
        await client.query(
          `INSERT INTO admin_discussion_read_state (
             subject_type,
             subject_id,
             user_id,
             last_read_message_id,
             updated_at
           )
           SELECT
             $1::text,
             $2::bigint,
             $3::bigint,
             message.id,
             NOW()
           FROM admin_discussion_messages AS message
           WHERE message.id = $4::bigint
             AND message.subject_type = $1::text
             AND message.subject_id = $2::bigint
             AND message.deleted_at IS NULL
           ON CONFLICT (subject_type, subject_id, user_id)
           DO UPDATE SET
             last_read_message_id =
               GREATEST(
                 admin_discussion_read_state.last_read_message_id,
                 EXCLUDED.last_read_message_id
               ),
             updated_at = NOW()
           RETURNING
             subject_type AS "subjectType",
             subject_id::integer AS "subjectId",
             user_id::integer AS "userId",
             last_read_message_id::integer AS "lastReadMessageId",
             updated_at AS "updatedAt"`,
          [
            subjectType,
            subjectId,
            userId,
            messageId,
          ],
        );

      return result.rows[0] ?? null;
    },

    async latestMessageId(
      subjectType,
      subjectId,
      queryable = database,
    ) {
      const result =
        await queryable.query(
          `SELECT MAX(id)::integer AS id
           FROM admin_discussion_messages
           WHERE subject_type = $1::text
             AND subject_id = $2::bigint
             AND deleted_at IS NULL`,
          [
            subjectType,
            subjectId,
          ],
        );

      return result.rows[0]?.id ?? null;
    },

    async createMessage(
      client,
      {
        subjectType,
        subjectId,
        authorUserId,
        subjectRevision,
        message,
      },
    ) {
      const result =
        await client.query(
          `INSERT INTO admin_discussion_messages (
             subject_type,
             subject_id,
             author_user_id,
             subject_revision,
             message
           )
           VALUES (
             $1::text,
             $2::bigint,
             $3::bigint,
             $4::timestamptz,
             $5::text
           )
           RETURNING id::integer AS id`,
          [
            subjectType,
            subjectId,
            authorUserId,
            subjectRevision,
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
