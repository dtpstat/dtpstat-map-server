/** @param {{ query: Function }} database */
export function createAdminAuditRepository(database) {
  return {
    async appendAudit(entry) {
      const result = await database.query(
        `INSERT INTO admin_audit_log(
           event_type,operation_type,status,duration_ms,
           ip_address,user_id,username,details
         )
         VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
         RETURNING id::integer AS id,
           created_at AS "createdAt"`,
        [
          entry.eventType,
          entry.operationType,
          entry.status,
          entry.durationMs ?? null,
          entry.ipAddress ?? null,
          entry.userId ?? null,
          entry.username ?? null,
          JSON.stringify(entry.details ?? {}),
        ],
      );
      return result.rows[0];
    },

    async listAudit(options = {}) {
      const values = [];
      const where = [];
      const add = (sql, value) => {
        values.push(value);
        where.push(
          sql.replace('?', `$${values.length}`),
        );
      };

      if (options.from) {
        add('created_at >= ?::timestamptz', options.from);
      }
      if (options.to) {
        add('created_at < ?::timestamptz', options.to);
      }
      if (options.eventType) {
        add('event_type = ?', options.eventType);
      }
      if (options.operationType) {
        add('operation_type = ?', options.operationType);
      }
      if (options.status) {
        add('status = ?', options.status);
      }
      if (options.username) {
        add(
          'LOWER(username) = LOWER(?)',
          options.username,
        );
      }
      if (options.ipAddress) {
        add('ip_address = ?', options.ipAddress);
      }

      values.push(options.limit ?? 200);
      const limitRef = `$${values.length}`;
      values.push(options.offset ?? 0);
      const offsetRef = `$${values.length}`;

      const result = await database.query(
        `SELECT
           id::integer AS id,
           created_at AS "createdAt",
           event_type AS "eventType",
           operation_type AS "operationType",
           status,
           duration_ms::double precision AS "durationMs",
           ip_address AS "ipAddress",
           user_id::integer AS "userId",
           username,
           details,
           COALESCE((
             SELECT admin_user.avatar_data IS NOT NULL
             FROM admin_users AS admin_user
             WHERE admin_user.id = admin_audit_log.user_id
           ), FALSE) AS "hasAvatar"
         FROM admin_audit_log
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY created_at DESC, id DESC
         LIMIT ${limitRef}
         OFFSET ${offsetRef}`,
        values,
      );
      return result.rows;
    },

    async auditFacets() {
      const [events, operations, statuses] =
        await Promise.all([
          database.query(
            'SELECT DISTINCT event_type AS value ' +
              'FROM admin_audit_log ORDER BY value',
          ),
          database.query(
            'SELECT DISTINCT operation_type AS value ' +
              'FROM admin_audit_log ORDER BY value',
          ),
          database.query(
            'SELECT DISTINCT status AS value ' +
              'FROM admin_audit_log ORDER BY value',
          ),
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
        'DELETE FROM admin_audit_log ' +
          'WHERE created_at < NOW() - ' +
          'make_interval(days => $1::integer)',
        [retentionDays],
      );
      return result.rowCount ?? 0;
    },
  };
}
