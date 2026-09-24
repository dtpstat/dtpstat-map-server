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
  password_min_length AS "passwordMinLength",
  password_max_length AS "passwordMaxLength",
  password_require_lowercase AS "passwordRequireLowercase",
  password_require_uppercase AS "passwordRequireUppercase",
  password_require_digit AS "passwordRequireDigit",
  password_require_special AS "passwordRequireSpecial",
  updated_at AS "updatedAt"
`;

const RECORD_FAILED_IP_SQL = `
  INSERT INTO admin_login_ip_state (
    ip_address, failed_login_count, failure_window_started_at,
    locked_until, updated_at
  )
  VALUES ($1::inet, 1, $2::timestamptz, NULL, NOW())
  ON CONFLICT (ip_address) DO UPDATE SET
    failed_login_count = CASE
      WHEN admin_login_ip_state.failure_window_started_at IS NULL
        OR admin_login_ip_state.failure_window_started_at <
          $2::timestamptz - make_interval(secs => $3::integer)
        OR (
          admin_login_ip_state.locked_until IS NOT NULL
          AND admin_login_ip_state.locked_until <= $2::timestamptz
        )
        THEN 1
      ELSE admin_login_ip_state.failed_login_count + 1
    END,
    failure_window_started_at = CASE
      WHEN admin_login_ip_state.failure_window_started_at IS NULL
        OR admin_login_ip_state.failure_window_started_at <
          $2::timestamptz - make_interval(secs => $3::integer)
        OR (
          admin_login_ip_state.locked_until IS NOT NULL
          AND admin_login_ip_state.locked_until <= $2::timestamptz
        )
        THEN $2::timestamptz
      ELSE admin_login_ip_state.failure_window_started_at
    END,
    locked_until = CASE
      WHEN (
        CASE
          WHEN admin_login_ip_state.failure_window_started_at IS NULL
            OR admin_login_ip_state.failure_window_started_at <
              $2::timestamptz - make_interval(secs => $3::integer)
            OR (
              admin_login_ip_state.locked_until IS NOT NULL
              AND admin_login_ip_state.locked_until <= $2::timestamptz
            )
            THEN 1
          ELSE admin_login_ip_state.failed_login_count + 1
        END
      ) >= $4::integer
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
export function createAdminAccessControlRepository(database) {
  return {
    async getSecuritySettings() {
      const result = await database.query(
        `SELECT ${SECURITY_FIELDS_SQL}
         FROM admin_security_settings
         WHERE id = 1`,
      );
      if (!result.rows[0]) {
        throw new Error(
          'Admin security settings row is missing; run database migrations',
        );
      }
      return result.rows[0];
    },

    async saveSecuritySettings(settings) {
      const result = await database.query(
        `UPDATE admin_security_settings
         SET
           max_failed_attempts=$1,
           failure_window_seconds=$2,
           lockout_seconds=$3,
           ip_max_failed_attempts=$4,
           ip_failure_window_seconds=$5,
           ip_lockout_seconds=$6,
           session_idle_seconds=$7,
           session_absolute_seconds=$8,
           audit_retention_days=$9,
           password_min_length=$10,
           password_max_length=$11,
           password_require_lowercase=$12,
           password_require_uppercase=$13,
           password_require_digit=$14,
           password_require_special=$15,
           updated_at=NOW()
         WHERE id=1
         RETURNING ${SECURITY_FIELDS_SQL}`,
        [
          settings.maxFailedAttempts,
          settings.failureWindowSeconds,
          settings.lockoutSeconds,
          settings.ipMaxFailedAttempts,
          settings.ipFailureWindowSeconds,
          settings.ipLockoutSeconds,
          settings.sessionIdleSeconds,
          settings.sessionAbsoluteSeconds,
          settings.auditRetentionDays,
          settings.passwordMinLength,
          settings.passwordMaxLength,
          settings.passwordRequireLowercase,
          settings.passwordRequireUppercase,
          settings.passwordRequireDigit,
          settings.passwordRequireSpecial,
        ],
      );
      if (!result.rows[0]) {
        throw new Error(
          'Admin security settings row is missing; run database migrations',
        );
      }
      return result.rows[0];
    },

    async getIpState(ipAddress) {
      if (!ipAddress) return null;
      const result = await database.query(
        `SELECT
           host(ip_address) AS "ipAddress",
           failed_login_count AS "failedLoginCount",
           failure_window_started_at AS "failureWindowStartedAt",
           locked_until AS "lockedUntil"
         FROM admin_login_ip_state
         WHERE ip_address=$1::inet`,
        [ipAddress],
      );
      return result.rows[0] ?? null;
    },

    async recordFailedIp(ipAddress, timestamp, settings) {
      if (!ipAddress) return null;
      const result = await database.query(
        RECORD_FAILED_IP_SQL,
        [
          ipAddress,
          timestamp,
          settings.ipFailureWindowSeconds,
          settings.ipMaxFailedAttempts,
          settings.ipLockoutSeconds,
        ],
      );
      return result.rows[0] ?? null;
    },

    async clearIpFailures(ipAddress) {
      if (!ipAddress) return;
      await database.query(
        'DELETE FROM admin_login_ip_state ' +
          'WHERE ip_address=$1::inet',
        [ipAddress],
      );
    },

    async isIpBlocked(ipAddress) {
      if (!ipAddress) return null;
      const result = await database.query(
        `SELECT
           id::integer AS id,
           host(ip_address) AS "ipAddress",
           created_at AS "createdAt",
           expires_at AS "expiresAt",
           blocked_by::integer AS "blockedBy",
           reason,
           source_audit_id::integer AS "sourceAuditId"
         FROM admin_blocked_ips
         WHERE ip_address=$1::inet
           AND (expires_at IS NULL OR expires_at>NOW())
         ORDER BY created_at DESC
         LIMIT 1`,
        [ipAddress],
      );
      return result.rows[0] ?? null;
    },

    async listIpBlocks() {
      const result = await database.query(
        `SELECT
           id::integer AS id,
           host(ip_address) AS "ipAddress",
           created_at AS "createdAt",
           expires_at AS "expiresAt",
           blocked_by::integer AS "blockedBy",
           reason,
           source_audit_id::integer AS "sourceAuditId"
         FROM admin_blocked_ips
         WHERE expires_at IS NULL OR expires_at>NOW()
         ORDER BY created_at DESC`,
      );
      return result.rows;
    },

    async createIpBlock(block) {
      const result = await database.query(
        `INSERT INTO admin_blocked_ips(
           ip_address,expires_at,blocked_by,reason,source_audit_id
         )
         VALUES($1::inet,$2,$3,$4,$5)
         RETURNING
           id::integer AS id,
           host(ip_address) AS "ipAddress",
           created_at AS "createdAt",
           expires_at AS "expiresAt",
           blocked_by::integer AS "blockedBy",
           reason,
           source_audit_id::integer AS "sourceAuditId"`,
        [
          block.ipAddress,
          block.expiresAt,
          block.blockedBy,
          block.reason,
          block.sourceAuditId,
        ],
      );
      return result.rows[0];
    },

    async deleteIpBlock(blockId) {
      const result = await database.query(
        'DELETE FROM admin_blocked_ips ' +
          'WHERE id=$1 RETURNING id',
        [blockId],
      );
      return (result.rowCount ?? result.rows.length) > 0;
    },
  };
}
