const USER_FIELDS_SQL = `
  id::integer AS id,
  username,
  email,
  can_manage_data AS "canManageData",
  can_manage_interface AS "canManageInterface",
  is_superuser AS "isSuperuser",
  is_bootstrap AS "isBootstrap",
  is_blocked AS "isBlocked",
  failed_login_count AS "failedLoginCount",
  failed_login_window_started_at AS "failedLoginWindowStartedAt",
  locked_until AS "lockedUntil",
  last_login_at AS "lastLoginAt",
  password_changed_at AS "passwordChangedAt",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

const AUTH_USER_SQL = `
  SELECT
    ${USER_FIELDS_SQL},
    password_hash AS "passwordHash"
  FROM admin_users
  WHERE LOWER(BTRIM(username)) = LOWER(BTRIM($1))
  LIMIT 1
`;

const LIST_USERS_SQL = `
  SELECT ${USER_FIELDS_SQL}
  FROM admin_users
  ORDER BY is_bootstrap DESC, is_superuser DESC, LOWER(username), id
`;

const GET_USER_SQL = `
  SELECT ${USER_FIELDS_SQL}
  FROM admin_users
  WHERE id = $1
`;

const CREATE_USER_SQL = `
  INSERT INTO admin_users (
    username,
    email,
    password_hash,
    can_manage_data,
    can_manage_interface,
    is_superuser,
    is_bootstrap
  )
  VALUES ($1, $2, $3, $4, $5, $6, $7)
  RETURNING ${USER_FIELDS_SQL}
`;

const UPDATE_USER_SQL = `
  UPDATE admin_users
  SET
    email = $2,
    can_manage_data = $3,
    can_manage_interface = $4,
    is_blocked = $5,
    updated_at = NOW()
  WHERE id = $1
  RETURNING ${USER_FIELDS_SQL}
`;

const UPDATE_PASSWORD_SQL = `
  UPDATE admin_users
  SET
    password_hash = $2,
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
  WITH current_user AS (
    SELECT
      id,
      failed_login_count,
      failed_login_window_started_at,
      locked_until,
      (
        failed_login_window_started_at IS NULL
        OR failed_login_window_started_at < $2::timestamptz - make_interval(secs => $3::integer)
        OR (locked_until IS NOT NULL AND locked_until <= $2::timestamptz)
      ) AS reset_window
    FROM admin_users
    WHERE id = $1
    FOR UPDATE
  ),
  next_state AS (
    SELECT
      id,
      CASE WHEN reset_window THEN 1 ELSE failed_login_count + 1 END AS next_count,
      CASE
        WHEN reset_window THEN $2::timestamptz
        ELSE failed_login_window_started_at
      END AS next_window_started_at
    FROM current_user
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
  WHERE users.id = next_state.id
  RETURNING ${USER_FIELDS_SQL}
`;

const GET_SECURITY_SETTINGS_SQL = `
  SELECT
    max_failed_attempts AS "maxFailedAttempts",
    failure_window_seconds AS "failureWindowSeconds",
    lockout_seconds AS "lockoutSeconds",
    updated_at AS "updatedAt"
  FROM admin_security_settings
  WHERE id = 1
`;

const UPDATE_SECURITY_SETTINGS_SQL = `
  UPDATE admin_security_settings
  SET
    max_failed_attempts = $1,
    failure_window_seconds = $2,
    lockout_seconds = $3,
    updated_at = NOW()
  WHERE id = 1
  RETURNING
    max_failed_attempts AS "maxFailedAttempts",
    failure_window_seconds AS "failureWindowSeconds",
    lockout_seconds AS "lockoutSeconds",
    updated_at AS "updatedAt"
`;

const INSERT_AUDIT_SQL = `
  INSERT INTO admin_audit_log (
    event_type,
    operation_type,
    status,
    duration_ms,
    ip_address,
    user_id,
    username,
    details
  )
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
  RETURNING id::integer AS id, created_at AS "createdAt"
`;

const LIST_AUDIT_SQL = `
  SELECT
    id::integer AS id,
    created_at AS "createdAt",
    event_type AS "eventType",
    operation_type AS "operationType",
    status,
    duration_ms::double precision AS "durationMs",
    ip_address AS "ipAddress",
    user_id::integer AS "userId",
    username,
    details
  FROM admin_audit_log
  ORDER BY created_at DESC, id DESC
  LIMIT $1 OFFSET $2
`;

/**
 * @param {{ query: (text: string, values?: unknown[]) => Promise<{rows: any[], rowCount?: number}> }} database
 */
export function createAdminSecurityRepository(database) {
  return {
    async countUsers() {
      const result = await database.query('SELECT COUNT(*)::integer AS count FROM admin_users');
      return result.rows[0]?.count ?? 0;
    },

    async findUserByUsername(username) {
      const result = await database.query(AUTH_USER_SQL, [username]);
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
        user.email,
        user.passwordHash,
        user.canManageData,
        user.canManageInterface,
        user.isSuperuser,
        Boolean(user.isBootstrap),
      ]);
      return result.rows[0];
    },

    async updateUser(userId, user) {
      const result = await database.query(UPDATE_USER_SQL, [
        userId,
        user.email,
        user.canManageData,
        user.canManageInterface,
        user.isBlocked,
      ]);
      return result.rows[0] ?? null;
    },

    async updatePassword(userId, passwordHash) {
      const result = await database.query(UPDATE_PASSWORD_SQL, [userId, passwordHash]);
      return result.rows[0] ?? null;
    },

    async recordSuccessfulLogin(userId, timestamp) {
      const result = await database.query(RECORD_SUCCESSFUL_LOGIN_SQL, [userId, timestamp]);
      return result.rows[0] ?? null;
    },

    async recordFailedLogin(userId, timestamp, settings) {
      const result = await database.query(RECORD_FAILED_LOGIN_SQL, [
        userId,
        timestamp,
        settings.failureWindowSeconds,
        settings.maxFailedAttempts,
        settings.lockoutSeconds,
      ]);
      return result.rows[0] ?? null;
    },

    async getSecuritySettings() {
      const result = await database.query(GET_SECURITY_SETTINGS_SQL);
      if (!result.rows[0]) {
        throw new Error('Admin security settings row is missing; run database migrations');
      }
      return result.rows[0];
    },

    async saveSecuritySettings(settings) {
      const result = await database.query(UPDATE_SECURITY_SETTINGS_SQL, [
        settings.maxFailedAttempts,
        settings.failureWindowSeconds,
        settings.lockoutSeconds,
      ]);
      if (!result.rows[0]) {
        throw new Error('Admin security settings row is missing; run database migrations');
      }
      return result.rows[0];
    },

    async appendAudit(entry) {
      const result = await database.query(INSERT_AUDIT_SQL, [
        entry.eventType,
        entry.operationType,
        entry.status,
        entry.durationMs ?? null,
        entry.ipAddress ?? null,
        entry.userId ?? null,
        entry.username ?? null,
        JSON.stringify(entry.details ?? {}),
      ]);
      return result.rows[0];
    },

    async listAudit({ limit = 200, offset = 0 } = {}) {
      const result = await database.query(LIST_AUDIT_SQL, [limit, offset]);
      return result.rows;
    },
  };
}
