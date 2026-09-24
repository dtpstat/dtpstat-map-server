const USER_FIELDS_SQL = `
  id::integer AS id,
  username,
  display_name AS "displayName",
  email,
  can_manage_data AS "canManageData",
  can_manage_interface AS "canManageInterface",
  can_edit_osm AS "canEditOsm",
  can_manage_users AS "canManageUsers",
  can_view_audit AS "canViewAudit",
  can_manage_security AS "canManageSecurity",
  is_superuser AS "isSuperuser",
  is_bootstrap AS "isBootstrap",
  is_blocked AS "isBlocked",
  manual_blocked_at AS "manualBlockedAt",
  manual_blocked_until AS "manualBlockedUntil",
  manual_block_reason AS "manualBlockReason",
  manual_blocked_by::integer AS "manualBlockedBy",
  must_change_password AS "mustChangePassword",
  (avatar_data IS NOT NULL) AS "hasAvatar",
  avatar_mime AS "avatarMime",
  failed_login_count AS "failedLoginCount",
  failed_login_window_started_at AS "failedLoginWindowStartedAt",
  locked_until AS "lockedUntil",
  last_login_at AS "lastLoginAt",
  password_changed_at AS "passwordChangedAt",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

const AUTH_USER_SQL = `
  SELECT ${USER_FIELDS_SQL}, password_hash AS "passwordHash"
  FROM admin_users
  WHERE LOWER(BTRIM(username)) = LOWER(BTRIM($1))
  LIMIT 1
`;

const AUTH_USER_BY_ID_SQL = `
  SELECT ${USER_FIELDS_SQL}, password_hash AS "passwordHash"
  FROM admin_users
  WHERE id = $1
`;

const LIST_USERS_SQL = `
  SELECT ${USER_FIELDS_SQL}
  FROM admin_users
  ORDER BY is_bootstrap DESC, is_superuser DESC,
           LOWER(display_name), LOWER(username), id
`;

const GET_USER_SQL =
  `SELECT ${USER_FIELDS_SQL} FROM admin_users WHERE id = $1`;

const CREATE_USER_SQL = `
  INSERT INTO admin_users (
    username, display_name, email, password_hash,
    can_manage_data, can_manage_interface, can_edit_osm, can_manage_users,
    can_view_audit, can_manage_security,
    is_superuser, is_bootstrap, must_change_password
  )
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
  RETURNING ${USER_FIELDS_SQL}
`;

const UPDATE_USER_SQL = `
  UPDATE admin_users
  SET
    display_name = $2,
    email = $3,
    can_manage_data = $4,
    can_manage_interface = $5,
    can_edit_osm = $6,
    can_manage_users = $7,
    can_view_audit = $8,
    can_manage_security = $9,
    is_blocked = $10,
    manual_blocked_at = $11,
    manual_blocked_until = $12,
    manual_block_reason = $13,
    manual_blocked_by = $14,
    updated_at = NOW()
  WHERE id = $1
  RETURNING ${USER_FIELDS_SQL}
`;

const UPDATE_PROFILE_SQL = `
  UPDATE admin_users
  SET display_name = $2, email = $3, updated_at = NOW()
  WHERE id = $1
  RETURNING ${USER_FIELDS_SQL}
`;

const UPDATE_PASSWORD_SQL = `
  UPDATE admin_users
  SET
    password_hash = $2,
    must_change_password = $3,
    password_changed_at = NOW(),
    failed_login_count = 0,
    failed_login_window_started_at = NULL,
    locked_until = NULL,
    updated_at = NOW()
  WHERE id = $1
  RETURNING ${USER_FIELDS_SQL}
`;

const RECORD_SUCCESSFUL_LOGIN_SQL = `
  UPDATE admin_users
  SET
    failed_login_count = 0,
    failed_login_window_started_at = NULL,
    locked_until = NULL,
    last_login_at = $2::timestamptz,
    updated_at = NOW()
  WHERE id = $1
  RETURNING ${USER_FIELDS_SQL}
`;

const RECORD_FAILED_LOGIN_SQL = `
  WITH locked_user AS (
    SELECT id, failed_login_count, failed_login_window_started_at, locked_until,
      (
        failed_login_window_started_at IS NULL
        OR failed_login_window_started_at < $2::timestamptz - make_interval(secs => $3::integer)
        OR (locked_until IS NOT NULL AND locked_until <= $2::timestamptz)
      ) AS reset_window
    FROM admin_users
    WHERE id = $1
    FOR UPDATE
  ), next_state AS (
    SELECT id AS user_id,
      CASE WHEN reset_window THEN 1 ELSE failed_login_count + 1 END AS next_count,
      CASE WHEN reset_window THEN $2::timestamptz ELSE failed_login_window_started_at END AS next_window_started_at
    FROM locked_user
  )
  UPDATE admin_users AS users
  SET
    failed_login_count = next_state.next_count,
    failed_login_window_started_at = next_state.next_window_started_at,
    locked_until = CASE
      WHEN next_state.next_count >= $4::integer
        THEN $2::timestamptz + make_interval(secs => $5::integer)
      ELSE NULL
    END,
    updated_at = NOW()
  FROM next_state
  WHERE users.id = next_state.user_id
  RETURNING
    users.failed_login_count AS "failedLoginCount",
    users.locked_until AS "lockedUntil"
`;

/** @param {{ query: Function }} database */
export function createAdminUserRepository(database) {
  return {
    async countUsers() {
      const result = await database.query(
        'SELECT COUNT(*)::integer AS count FROM admin_users',
      );
      return result.rows[0]?.count ?? 0;
    },

    async findUserByUsername(username) {
      const result = await database.query(AUTH_USER_SQL, [username]);
      return result.rows[0] ?? null;
    },

    async getAuthUser(userId) {
      const result = await database.query(
        AUTH_USER_BY_ID_SQL,
        [userId],
      );
      return result.rows[0] ?? null;
    },

    async getUser(userId) {
      const result = await database.query(GET_USER_SQL, [userId]);
      return result.rows[0] ?? null;
    },

    async listUsers() {
      const result = await database.query(LIST_USERS_SQL);
      return result.rows;
    },

    async createUser(user) {
      const result = await database.query(CREATE_USER_SQL, [
        user.username,
        user.displayName,
        user.email,
        user.passwordHash,
        user.canManageData,
        user.canManageInterface,
        user.canEditOsm,
        user.canManageUsers,
        user.canViewAudit,
        user.canManageSecurity,
        user.isSuperuser,
        Boolean(user.isBootstrap),
        Boolean(user.mustChangePassword),
      ]);
      return result.rows[0];
    },

    async updateUser(userId, user) {
      const result = await database.query(UPDATE_USER_SQL, [
        userId,
        user.displayName,
        user.email,
        user.canManageData,
        user.canManageInterface,
        user.canEditOsm,
        user.canManageUsers,
        user.canViewAudit,
        user.canManageSecurity,
        user.isBlocked,
        user.manualBlockedAt ?? null,
        user.manualBlockedUntil ?? null,
        user.manualBlockReason ?? null,
        user.manualBlockedBy ?? null,
      ]);
      return result.rows[0] ?? null;
    },

    async updateProfile(userId, profile) {
      const result = await database.query(UPDATE_PROFILE_SQL, [
        userId,
        profile.displayName,
        profile.email,
      ]);
      return result.rows[0] ?? null;
    },

    async deleteUser(userId) {
      const result = await database.query(
        `DELETE FROM admin_users
         WHERE id = $1
         RETURNING ${USER_FIELDS_SQL}`,
        [userId],
      );
      return result.rows[0] ?? null;
    },

    async updatePassword(
      userId,
      passwordHash,
      mustChangePassword = false,
    ) {
      const result = await database.query(UPDATE_PASSWORD_SQL, [
        userId,
        passwordHash,
        mustChangePassword,
      ]);
      return result.rows[0] ?? null;
    },

    async recordSuccessfulLogin(userId, timestamp) {
      const result = await database.query(
        RECORD_SUCCESSFUL_LOGIN_SQL,
        [userId, timestamp],
      );
      return result.rows[0] ?? null;
    },

    async recordFailedLogin(userId, timestamp, settings) {
      const result = await database.query(
        RECORD_FAILED_LOGIN_SQL,
        [
          userId,
          timestamp,
          settings.failureWindowSeconds,
          settings.maxFailedAttempts,
          settings.lockoutSeconds,
        ],
      );
      return result.rows[0] ?? null;
    },

    async saveAvatar(userId, mime, data) {
      const result = await database.query(
        `UPDATE admin_users
         SET avatar_mime=$2, avatar_data=$3, updated_at=NOW()
         WHERE id=$1
         RETURNING ${USER_FIELDS_SQL}`,
        [userId, mime, data],
      );
      return result.rows[0] ?? null;
    },

    async clearAvatar(userId) {
      const result = await database.query(
        `UPDATE admin_users
         SET avatar_mime=NULL, avatar_data=NULL, updated_at=NOW()
         WHERE id=$1
         RETURNING ${USER_FIELDS_SQL}`,
        [userId],
      );
      return result.rows[0] ?? null;
    },

    async getAvatar(userId) {
      const result = await database.query(
        'SELECT avatar_mime AS mime, avatar_data AS data ' +
          'FROM admin_users WHERE id=$1',
        [userId],
      );
      return result.rows[0] ?? null;
    },
  };
}
