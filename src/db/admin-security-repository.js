const USER_FIELDS_SQL = `
  id::integer AS id,
  username,
  display_name AS "displayName",
  email,
  can_manage_data AS "canManageData",
  can_manage_interface AS "canManageInterface",
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
  ORDER BY is_bootstrap DESC, is_superuser DESC, LOWER(display_name), LOWER(username), id
`;

const GET_USER_SQL = `SELECT ${USER_FIELDS_SQL} FROM admin_users WHERE id = $1`;

const CREATE_USER_SQL = `
  INSERT INTO admin_users (
    username, display_name, email, password_hash,
    can_manage_data, can_manage_interface, can_manage_users,
    can_view_audit, can_manage_security,
    is_superuser, is_bootstrap, must_change_password
  )
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
  RETURNING ${USER_FIELDS_SQL}
`;

const UPDATE_USER_SQL = `
  UPDATE admin_users
  SET
    display_name = $2,
    email = $3,
    can_manage_data = $4,
    can_manage_interface = $5,
    can_manage_users = $6,
    can_view_audit = $7,
    can_manage_security = $8,
    is_blocked = $9,
    manual_blocked_at = $10,
    manual_blocked_until = $11,
    manual_block_reason = $12,
    manual_blocked_by = $13,
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
  WITH current_user AS (
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
    SELECT id,
      CASE WHEN reset_window THEN 1 ELSE failed_login_count + 1 END AS next_count,
      CASE WHEN reset_window THEN $2::timestamptz ELSE failed_login_window_started_at END AS next_window_started_at
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

const SECURITY_FIELDS_SQL = `
  max_failed_attempts AS "maxFailedAttempts",
  failure_window_seconds AS "failureWindowSeconds",
  lockout_seconds AS "lockoutSeconds",
  ip_max_failed_attempts AS "ipMaxFailedAttempts",
  ip_failure_window_seconds AS "ipFailureWindowSeconds",
  ip_lockout_seconds AS "ipLockoutSeconds",
  session_idle_seconds AS "sessionIdleSeconds",
  session_absolute_seconds AS "sessionAbsoluteSeconds",
  audit_retention_days AS "auditRetentionDays",
  updated_at AS "updatedAt"
`;

const RECORD_FAILED_IP_SQL = `
  INSERT INTO admin_login_ip_state (
    ip_address, failed_login_count, failure_window_started_at, locked_until, updated_at
  )
  VALUES ($1::inet, 1, $2::timestamptz, NULL, NOW())
  ON CONFLICT (ip_address) DO UPDATE SET
    failed_login_count = CASE
      WHEN admin_login_ip_state.failure_window_started_at IS NULL
        OR admin_login_ip_state.failure_window_started_at < $2::timestamptz - make_interval(secs => $3::integer)
        OR (admin_login_ip_state.locked_until IS NOT NULL AND admin_login_ip_state.locked_until <= $2::timestamptz)
        THEN 1
      ELSE admin_login_ip_state.failed_login_count + 1
    END,
    failure_window_started_at = CASE
      WHEN admin_login_ip_state.failure_window_started_at IS NULL
        OR admin_login_ip_state.failure_window_started_at < $2::timestamptz - make_interval(secs => $3::integer)
        OR (admin_login_ip_state.locked_until IS NOT NULL AND admin_login_ip_state.locked_until <= $2::timestamptz)
        THEN $2::timestamptz
      ELSE admin_login_ip_state.failure_window_started_at
    END,
    locked_until = CASE
      WHEN (CASE
        WHEN admin_login_ip_state.failure_window_started_at IS NULL
          OR admin_login_ip_state.failure_window_started_at < $2::timestamptz - make_interval(secs => $3::integer)
          OR (admin_login_ip_state.locked_until IS NOT NULL AND admin_login_ip_state.locked_until <= $2::timestamptz)
          THEN 1
        ELSE admin_login_ip_state.failed_login_count + 1
      END) >= $4::integer
        THEN $2::timestamptz + make_interval(secs => $5::integer)
      ELSE NULL
    END,
    updated_at = NOW()
  RETURNING
    host(ip_address) AS "ipAddress",
    failed_login_count AS "failedLoginCount",
    failure_window_started_at AS "failureWindowStartedAt",
    locked_until AS "lockedUntil"
`;

/** @param {{ query: Function }} database */
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
    async getAuthUser(userId) {
      const result = await database.query(AUTH_USER_BY_ID_SQL, [userId]);
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
        user.username, user.displayName, user.email, user.passwordHash,
        user.canManageData, user.canManageInterface, user.canManageUsers,
        user.canViewAudit, user.canManageSecurity,
        user.isSuperuser, Boolean(user.isBootstrap), Boolean(user.mustChangePassword),
      ]);
      return result.rows[0];
    },
    async updateUser(userId, user) {
      const result = await database.query(UPDATE_USER_SQL, [
        userId, user.displayName, user.email,
        user.canManageData, user.canManageInterface, user.canManageUsers,
        user.canViewAudit, user.canManageSecurity,
        user.isBlocked, user.manualBlockedAt ?? null, user.manualBlockedUntil ?? null,
        user.manualBlockReason ?? null, user.manualBlockedBy ?? null,
      ]);
      return result.rows[0] ?? null;
    },
    async updateProfile(userId, profile) {
      const result = await database.query(UPDATE_PROFILE_SQL, [
        userId, profile.displayName, profile.email,
      ]);
      return result.rows[0] ?? null;
    },
    async deleteUser(userId) {
      const result = await database.query(
        `DELETE FROM admin_users WHERE id = $1 RETURNING ${USER_FIELDS_SQL}`,
        [userId],
      );
      return result.rows[0] ?? null;
    },
    async updatePassword(userId, passwordHash, mustChangePassword = false) {
      const result = await database.query(UPDATE_PASSWORD_SQL, [
        userId, passwordHash, mustChangePassword,
      ]);
      return result.rows[0] ?? null;
    },
    async recordSuccessfulLogin(userId, timestamp) {
      const result = await database.query(RECORD_SUCCESSFUL_LOGIN_SQL, [userId, timestamp]);
      return result.rows[0] ?? null;
    },
    async recordFailedLogin(userId, timestamp, settings) {
      const result = await database.query(RECORD_FAILED_LOGIN_SQL, [
        userId, timestamp, settings.failureWindowSeconds,
        settings.maxFailedAttempts, settings.lockoutSeconds,
      ]);
      return result.rows[0] ?? null;
    },
    async getSecuritySettings() {
      const result = await database.query(`SELECT ${SECURITY_FIELDS_SQL} FROM admin_security_settings WHERE id = 1`);
      if (!result.rows[0]) throw new Error('Admin security settings row is missing; run database migrations');
      return result.rows[0];
    },
    async saveSecuritySettings(settings) {
      const result = await database.query(`
        UPDATE admin_security_settings SET
          max_failed_attempts=$1, failure_window_seconds=$2, lockout_seconds=$3,
          ip_max_failed_attempts=$4, ip_failure_window_seconds=$5, ip_lockout_seconds=$6,
          session_idle_seconds=$7, session_absolute_seconds=$8, audit_retention_days=$9,
          updated_at=NOW()
        WHERE id=1 RETURNING ${SECURITY_FIELDS_SQL}
      `, [
        settings.maxFailedAttempts, settings.failureWindowSeconds, settings.lockoutSeconds,
        settings.ipMaxFailedAttempts, settings.ipFailureWindowSeconds, settings.ipLockoutSeconds,
        settings.sessionIdleSeconds, settings.sessionAbsoluteSeconds, settings.auditRetentionDays,
      ]);
      if (!result.rows[0]) throw new Error('Admin security settings row is missing; run database migrations');
      return result.rows[0];
    },
    async getIpState(ipAddress) {
      if (!ipAddress) return null;
      const result = await database.query(`
        SELECT host(ip_address) AS "ipAddress", failed_login_count AS "failedLoginCount",
          failure_window_started_at AS "failureWindowStartedAt", locked_until AS "lockedUntil"
        FROM admin_login_ip_state WHERE ip_address=$1::inet
      `, [ipAddress]);
      return result.rows[0] ?? null;
    },
    async recordFailedIp(ipAddress, timestamp, settings) {
      if (!ipAddress) return null;
      const result = await database.query(RECORD_FAILED_IP_SQL, [
        ipAddress, timestamp, settings.ipFailureWindowSeconds,
        settings.ipMaxFailedAttempts, settings.ipLockoutSeconds,
      ]);
      return result.rows[0] ?? null;
    },
    async clearIpFailures(ipAddress) {
      if (!ipAddress) return;
      await database.query('DELETE FROM admin_login_ip_state WHERE ip_address=$1::inet', [ipAddress]);
    },
    async createSession(session) {
      const result = await database.query(`
        INSERT INTO admin_sessions(user_id,token_hash,expires_at,ip_address,user_agent)
        VALUES($1,$2,$3,$4::inet,$5)
        RETURNING id::integer AS id, created_at AS "createdAt", last_seen_at AS "lastSeenAt", expires_at AS "expiresAt"
      `, [session.userId, session.tokenHash, session.expiresAt, session.ipAddress, session.userAgent]);
      return result.rows[0];
    },
    async findSession(tokenHash) {
      const result = await database.query(`
        SELECT ${SESSION_USER_FIELDS}
        FROM admin_sessions AS session
        JOIN admin_users AS users ON users.id=session.user_id
        WHERE session.token_hash=$1
      `, [tokenHash]);
      return result.rows[0] ?? null;
    },
    async touchSession(sessionId, timestamp) {
      await database.query('UPDATE admin_sessions SET last_seen_at=$2::timestamptz WHERE id=$1', [sessionId, timestamp]);
    },
    async revokeSessionByHash(tokenHash) {
      await database.query('DELETE FROM admin_sessions WHERE token_hash=$1', [tokenHash]);
    },
    async revokeSessionById(userId, sessionId) {
      const result = await database.query(
        'DELETE FROM admin_sessions WHERE id=$1 AND user_id=$2 RETURNING id',
        [sessionId, userId],
      );
      return (result.rowCount ?? result.rows.length) > 0;
    },
    async revokeUserSessions(userId, exceptSessionId = null) {
      const result = await database.query(`
        DELETE FROM admin_sessions
        WHERE user_id=$1 AND ($2::bigint IS NULL OR id<>$2::bigint)
      `, [userId, exceptSessionId]);
      return result.rowCount ?? 0;
    },
    async listUserSessions(userId) {
      const result = await database.query(`
        SELECT id::integer AS id, created_at AS "createdAt", last_seen_at AS "lastSeenAt",
          expires_at AS "expiresAt", host(ip_address) AS "ipAddress", user_agent AS "userAgent"
        FROM admin_sessions WHERE user_id=$1 ORDER BY created_at DESC
      `, [userId]);
      return result.rows;
    },
    async saveAvatar(userId, mime, data) {
      const result = await database.query(`
        UPDATE admin_users SET avatar_mime=$2, avatar_data=$3, updated_at=NOW()
        WHERE id=$1 RETURNING ${USER_FIELDS_SQL}
      `, [userId, mime, data]);
      return result.rows[0] ?? null;
    },
    async clearAvatar(userId) {
      const result = await database.query(`
        UPDATE admin_users SET avatar_mime=NULL, avatar_data=NULL, updated_at=NOW()
        WHERE id=$1 RETURNING ${USER_FIELDS_SQL}
      `, [userId]);
      return result.rows[0] ?? null;
    },
    async getAvatar(userId) {
      const result = await database.query(
        'SELECT avatar_mime AS mime, avatar_data AS data FROM admin_users WHERE id=$1',
        [userId],
      );
      return result.rows[0] ?? null;
    },
    async isIpBlocked(ipAddress) {
      if (!ipAddress) return null;
      const result = await database.query(`
        SELECT id::integer AS id, host(ip_address) AS "ipAddress", created_at AS "createdAt",
          expires_at AS "expiresAt", blocked_by::integer AS "blockedBy", reason, source_audit_id::integer AS "sourceAuditId"
        FROM admin_blocked_ips
        WHERE ip_address=$1::inet AND (expires_at IS NULL OR expires_at>NOW())
        ORDER BY created_at DESC LIMIT 1
      `, [ipAddress]);
      return result.rows[0] ?? null;
    },
    async listIpBlocks() {
      const result = await database.query(`
        SELECT id::integer AS id, host(ip_address) AS "ipAddress", created_at AS "createdAt",
          expires_at AS "expiresAt", blocked_by::integer AS "blockedBy", reason, source_audit_id::integer AS "sourceAuditId"
        FROM admin_blocked_ips
        WHERE expires_at IS NULL OR expires_at>NOW()
        ORDER BY created_at DESC
      `);
      return result.rows;
    },
    async createIpBlock(block) {
      const result = await database.query(`
        INSERT INTO admin_blocked_ips(ip_address,expires_at,blocked_by,reason,source_audit_id)
        VALUES($1::inet,$2,$3,$4,$5)
        RETURNING id::integer AS id, host(ip_address) AS "ipAddress", created_at AS "createdAt",
          expires_at AS "expiresAt", blocked_by::integer AS "blockedBy", reason, source_audit_id::integer AS "sourceAuditId"
      `, [block.ipAddress, block.expiresAt, block.blockedBy, block.reason, block.sourceAuditId]);
      return result.rows[0];
    },
    async deleteIpBlock(blockId) {
      const result = await database.query('DELETE FROM admin_blocked_ips WHERE id=$1 RETURNING id', [blockId]);
      return (result.rowCount ?? result.rows.length) > 0;
    },
    async appendAudit(entry) {
      const result = await database.query(`
        INSERT INTO admin_audit_log(event_type,operation_type,status,duration_ms,ip_address,user_id,username,details)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
        RETURNING id::integer AS id, created_at AS "createdAt"
      `, [
        entry.eventType, entry.operationType, entry.status, entry.durationMs ?? null,
        entry.ipAddress ?? null, entry.userId ?? null, entry.username ?? null,
        JSON.stringify(entry.details ?? {}),
      ]);
      return result.rows[0];
    },
    async listAudit(options = {}) {
      const values = [];
      const where = [];
      const add = (sql, value) => {
        values.push(value);
        where.push(sql.replace('?', `$${values.length}`));
      };
      if (options.from) add('created_at >= ?::timestamptz', options.from);
      if (options.to) add('created_at < ?::timestamptz', options.to);
      if (options.eventType) add('event_type = ?', options.eventType);
      if (options.operationType) add('operation_type = ?', options.operationType);
      if (options.status) add('status = ?', options.status);
      if (options.username) add('LOWER(username) = LOWER(?)', options.username);
      if (options.ipAddress) add('ip_address = ?', options.ipAddress);
      values.push(options.limit ?? 200);
      const limitRef = `$${values.length}`;
      values.push(options.offset ?? 0);
      const offsetRef = `$${values.length}`;
      const result = await database.query(`
        SELECT id::integer AS id, created_at AS "createdAt", event_type AS "eventType",
          operation_type AS "operationType", status,
          duration_ms::double precision AS "durationMs", ip_address AS "ipAddress",
          user_id::integer AS "userId", username, details
        FROM admin_audit_log
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY created_at DESC, id DESC
        LIMIT ${limitRef} OFFSET ${offsetRef}
      `, values);
      return result.rows;
    },
    async auditFacets() {
      const [events, operations, statuses] = await Promise.all([
        database.query('SELECT DISTINCT event_type AS value FROM admin_audit_log ORDER BY value'),
        database.query('SELECT DISTINCT operation_type AS value FROM admin_audit_log ORDER BY value'),
        database.query('SELECT DISTINCT status AS value FROM admin_audit_log ORDER BY value'),
      ]);
      return {
        eventTypes: events.rows.map((row) => row.value),
        operationTypes: operations.rows.map((row) => row.value),
        statuses: statuses.rows.map((row) => row.value),
      };
    },
    async purgeAudit(retentionDays) {
      if (!retentionDays) return 0;
      const result = await database.query(
        'DELETE FROM admin_audit_log WHERE created_at < NOW() - make_interval(days => $1::integer)',
        [retentionDays],
      );
      return result.rowCount ?? 0;
    },
  };
}
