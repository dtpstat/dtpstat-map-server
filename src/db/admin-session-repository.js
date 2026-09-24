const SESSION_USER_FIELDS = `
  session.id::integer AS "sessionId",
  session.created_at AS "sessionCreatedAt",
  session.last_seen_at AS "sessionLastSeenAt",
  session.expires_at AS "sessionExpiresAt",
  host(session.ip_address) AS "sessionIpAddress",
  session.user_agent AS "sessionUserAgent",
  users.id::integer AS id,
  users.username,
  users.display_name AS "displayName",
  users.email,
  users.can_manage_data AS "canManageData",
  users.can_manage_interface AS "canManageInterface",
  users.can_edit_osm AS "canEditOsm",
  users.can_manage_users AS "canManageUsers",
  users.can_view_audit AS "canViewAudit",
  users.can_manage_security AS "canManageSecurity",
  users.is_superuser AS "isSuperuser",
  users.is_bootstrap AS "isBootstrap",
  users.is_blocked AS "isBlocked",
  users.manual_blocked_at AS "manualBlockedAt",
  users.manual_blocked_until AS "manualBlockedUntil",
  users.manual_block_reason AS "manualBlockReason",
  users.manual_blocked_by::integer AS "manualBlockedBy",
  users.must_change_password AS "mustChangePassword",
  (users.avatar_data IS NOT NULL) AS "hasAvatar",
  users.avatar_mime AS "avatarMime",
  users.failed_login_count AS "failedLoginCount",
  users.failed_login_window_started_at AS "failedLoginWindowStartedAt",
  users.locked_until AS "lockedUntil",
  users.last_login_at AS "lastLoginAt",
  users.password_changed_at AS "passwordChangedAt",
  users.created_at AS "createdAt",
  users.updated_at AS "updatedAt"
`;

/** @param {{ query: Function }} database */
export function createAdminSessionRepository(database) {
  return {
    async createSession(session) {
      const result = await database.query(
        `INSERT INTO admin_sessions(
           user_id,token_hash,expires_at,ip_address,user_agent
         )
         VALUES($1,$2,$3,$4::inet,$5)
         RETURNING id::integer AS id,
           created_at AS "createdAt",
           last_seen_at AS "lastSeenAt",
           expires_at AS "expiresAt"`,
        [
          session.userId,
          session.tokenHash,
          session.expiresAt,
          session.ipAddress,
          session.userAgent,
        ],
      );
      return result.rows[0];
    },

    async findSession(tokenHash) {
      const result = await database.query(
        `SELECT ${SESSION_USER_FIELDS}
         FROM admin_sessions AS session
         JOIN admin_users AS users
           ON users.id=session.user_id
         WHERE session.token_hash=$1`,
        [tokenHash],
      );
      return result.rows[0] ?? null;
    },

    async touchSession(sessionId, timestamp) {
      await database.query(
        'UPDATE admin_sessions ' +
          'SET last_seen_at=$2::timestamptz WHERE id=$1',
        [sessionId, timestamp],
      );
    },

    async revokeSessionByHash(tokenHash) {
      await database.query(
        'DELETE FROM admin_sessions WHERE token_hash=$1',
        [tokenHash],
      );
    },

    async revokeSessionById(userId, sessionId) {
      const result = await database.query(
        'DELETE FROM admin_sessions ' +
          'WHERE id=$1 AND user_id=$2 RETURNING id',
        [sessionId, userId],
      );
      return (result.rowCount ?? result.rows.length) > 0;
    },

    async revokeUserSessions(userId, exceptSessionId = null) {
      const result = await database.query(
        `DELETE FROM admin_sessions
         WHERE user_id=$1
           AND ($2::bigint IS NULL OR id<>$2::bigint)`,
        [userId, exceptSessionId],
      );
      return result.rowCount ?? 0;
    },

    async listUserSessions(userId) {
      const result = await database.query(
        `SELECT
           id::integer AS id,
           created_at AS "createdAt",
           last_seen_at AS "lastSeenAt",
           expires_at AS "expiresAt",
           host(ip_address) AS "ipAddress",
           user_agent AS "userAgent"
         FROM admin_sessions
         WHERE user_id=$1
         ORDER BY created_at DESC`,
        [userId],
      );
      return result.rows;
    },
  };
}
