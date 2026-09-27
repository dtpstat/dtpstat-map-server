const LEASE_COLUMNS_SQL = `
  lease.geometry_id::integer AS "geometryId",
  lease.token,
  lease.user_id::integer AS "userId",
  user_account.username,
  lease.client_id AS "clientId",
  lease.generation::integer AS generation,
  lease.acquired_at AS "acquiredAt",
  lease.last_seen_at AS "lastSeenAt",
  lease.expires_at AS "expiresAt"
`;

async function leaseByGeometry(
  queryable,
  geometryId,
  { activeOnly = true, forUpdate = false } = {},
) {
  const result =
    await queryable.query(
      `SELECT
         ${LEASE_COLUMNS_SQL}
       FROM geometry_edit_leases AS lease
       JOIN admin_users AS user_account
         ON user_account.id = lease.user_id
       WHERE lease.geometry_id = $1
         ${activeOnly ? 'AND lease.expires_at > NOW()' : ''}
       ${forUpdate ? 'FOR UPDATE OF lease' : ''}`,
      [geometryId],
    );
  return result.rows[0] ?? null;
}

export function createGeometryEditLeaseStorage(
  database,
) {
  return {
    async listActive(
      queryable = database,
    ) {
      const result =
        await queryable.query(
          `SELECT
             ${LEASE_COLUMNS_SQL}
           FROM geometry_edit_leases AS lease
           JOIN admin_users AS user_account
             ON user_account.id = lease.user_id
           WHERE lease.expires_at > NOW()
           ORDER BY lease.geometry_id`,
        );
      return result.rows;
    },

    active(
      queryable,
      geometryId,
    ) {
      return leaseByGeometry(
        queryable,
        geometryId,
      );
    },

    async geometryExists(
      queryable,
      geometryId,
    ) {
      const result =
        await queryable.query(
          'SELECT 1 FROM city_geometries WHERE id = $1',
          [geometryId],
        );
      return Boolean(
        result.rows[0],
      );
    },

    async acquire(
      client,
      {
        geometryId,
        token,
        userId,
        clientId,
        leaseSeconds,
      },
    ) {
      await client.query(
        `INSERT INTO geometry_edit_leases (
           geometry_id,
           token,
           user_id,
           client_id,
           generation,
           acquired_at,
           last_seen_at,
           expires_at
         )
         SELECT
           $1,
           $2,
           $3,
           $4,
           1,
           NOW(),
           NOW(),
           NOW() + ($5::integer * INTERVAL '1 second')
         WHERE EXISTS (
           SELECT 1
           FROM city_geometries
           WHERE id = $1
         )
         ON CONFLICT (geometry_id) DO UPDATE
         SET
           token = EXCLUDED.token,
           user_id = EXCLUDED.user_id,
           client_id = EXCLUDED.client_id,
           generation = geometry_edit_leases.generation + 1,
           acquired_at = NOW(),
           last_seen_at = NOW(),
           expires_at = NOW() + ($5::integer * INTERVAL '1 second')
         WHERE geometry_edit_leases.expires_at <= NOW()`,
        [
          geometryId,
          token,
          userId,
          clientId,
          leaseSeconds,
        ],
      );

      return leaseByGeometry(
        client,
        geometryId,
      );
    },

    async renew(
      client,
      {
        geometryId,
        token,
        userId,
        clientId,
        leaseSeconds,
      },
    ) {
      const result =
        await client.query(
          `UPDATE geometry_edit_leases
           SET
             client_id = $4,
             last_seen_at = NOW(),
             expires_at = NOW() + ($5::integer * INTERVAL '1 second')
           WHERE geometry_id = $1
             AND token = $2
             AND user_id = $3
           RETURNING geometry_id`,
          [
            geometryId,
            token,
            userId,
            clientId,
            leaseSeconds,
          ],
        );

      if (!result.rows[0]) {
        return null;
      }

      return leaseByGeometry(
        client,
        geometryId,
      );
    },

    async owns(
      queryable,
      {
        geometryId,
        token,
        userId,
      },
    ) {
      const result =
        await queryable.query(
          `SELECT 1
           FROM geometry_edit_leases
           WHERE geometry_id = $1
             AND token = $2
             AND user_id = $3
             AND expires_at > NOW()
           FOR SHARE`,
          [
            geometryId,
            token,
            userId,
          ],
        );
      return Boolean(
        result.rows[0],
      );
    },

    async release(
      client,
      {
        geometryId,
        token,
        userId,
      },
    ) {
      const result =
        await client.query(
          `DELETE FROM geometry_edit_leases
           WHERE geometry_id = $1
             AND token = $2
             AND user_id = $3
           RETURNING geometry_id`,
          [
            geometryId,
            token,
            userId,
          ],
        );
      return Boolean(
        result.rows[0],
      );
    },

    async forceTakeover(
      client,
      {
        geometryId,
        token,
        userId,
        clientId,
        leaseSeconds,
      },
    ) {
      const previous =
        await leaseByGeometry(
          client,
          geometryId,
          {
            activeOnly: false,
            forUpdate: true,
          },
        );

      const existsResult =
        await client.query(
          'SELECT 1 FROM city_geometries WHERE id = $1',
          [geometryId],
        );
      const exists =
        Boolean(
          existsResult.rows[0],
        );

      if (!exists) {
        return {
          previous,
          lease: null,
        };
      }

      await client.query(
        `INSERT INTO geometry_edit_leases (
           geometry_id,
           token,
           user_id,
           client_id,
           generation,
           acquired_at,
           last_seen_at,
           expires_at
         )
         VALUES (
           $1,
           $2,
           $3,
           $4,
           1,
           NOW(),
           NOW(),
           NOW() + ($5::integer * INTERVAL '1 second')
         )
         ON CONFLICT (geometry_id) DO UPDATE
         SET
           token = EXCLUDED.token,
           user_id = EXCLUDED.user_id,
           client_id = EXCLUDED.client_id,
           generation = geometry_edit_leases.generation + 1,
           acquired_at = NOW(),
           last_seen_at = NOW(),
           expires_at = NOW() + ($5::integer * INTERVAL '1 second')`,
        [
          geometryId,
          token,
          userId,
          clientId,
          leaseSeconds,
        ],
      );

      return {
        previous,
        lease:
          await leaseByGeometry(
            client,
            geometryId,
          ),
      };
    },
  };
}
