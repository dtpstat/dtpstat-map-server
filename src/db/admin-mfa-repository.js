/** @param {{ query: Function, connect?: Function }} database */
export function createAdminMfaRepository(
  database,
) {
  return {
    async getMfaState(
      userId,
    ) {
      const result =
        await database.query(
          `SELECT
             id AS user_id,
             mfa_enabled,
             mfa_secret_ciphertext,
             mfa_pending_secret_ciphertext,
             mfa_pending_created_at,
             mfa_last_used_step,
             mfa_enrolled_at
           FROM admin_users
           WHERE id=$1::bigint`,
          [
            userId,
          ],
        );

      const row =
        result.rows[0];

      if (!row) {
        return null;
      }

      return {
        userId:
          Number(
            row.user_id,
          ),
        enabled:
          Boolean(
            row.mfa_enabled,
          ),
        secretCiphertext:
          row.mfa_secret_ciphertext ??
          null,
        pendingSecretCiphertext:
          row.mfa_pending_secret_ciphertext ??
          null,
        pendingCreatedAt:
          row.mfa_pending_created_at ??
          null,
        lastUsedStep:
          row.mfa_last_used_step ===
            null ||
          row.mfa_last_used_step ===
            undefined
            ? null
            : Number(
                row.mfa_last_used_step,
              ),
        enrolledAt:
          row.mfa_enrolled_at ??
          null,
      };
    },

    async saveMfaPendingSecret(
      userId,
      ciphertext,
    ) {
      const result =
        await database.query(
          `UPDATE admin_users
           SET
             mfa_pending_secret_ciphertext=$2::bytea,
             mfa_pending_created_at=NOW(),
             updated_at=NOW()
           WHERE id=$1::bigint
           RETURNING mfa_pending_created_at AS "pendingCreatedAt"`,
          [
            userId,
            ciphertext,
          ],
        );

      return result.rows[0] ??
        null;
    },

    async clearMfaPendingSecret(
      userId,
    ) {
      const result =
        await database.query(
          `UPDATE admin_users
           SET
             mfa_pending_secret_ciphertext=NULL,
             mfa_pending_created_at=NULL,
             updated_at=NOW()
           WHERE id=$1::bigint
           RETURNING id::integer AS id`,
          [
            userId,
          ],
        );

      return Boolean(
        result.rows[0],
      );
    },

    async enableMfa(
      userId,
      lastUsedStep,
    ) {
      const result =
        await database.query(
          `UPDATE admin_users
           SET
             mfa_enabled=TRUE,
             mfa_secret_ciphertext=mfa_pending_secret_ciphertext,
             mfa_pending_secret_ciphertext=NULL,
             mfa_pending_created_at=NULL,
             mfa_last_used_step=$2::bigint,
             mfa_enrolled_at=NOW(),
             updated_at=NOW()
           WHERE id=$1::bigint
             AND mfa_pending_secret_ciphertext IS NOT NULL
           RETURNING id::integer AS id, mfa_enrolled_at AS "enrolledAt"`,
          [
            userId,
            lastUsedStep,
          ],
        );

      return result.rows[0] ??
        null;
    },

    async disableMfa(
      userId,
    ) {
      const result =
        await database.query(
          `UPDATE admin_users
           SET
             mfa_enabled=FALSE,
             mfa_secret_ciphertext=NULL,
             mfa_pending_secret_ciphertext=NULL,
             mfa_pending_created_at=NULL,
             mfa_last_used_step=NULL,
             mfa_enrolled_at=NULL,
             updated_at=NOW()
           WHERE id=$1::bigint
           RETURNING id::integer AS id`,
          [
            userId,
          ],
        );

      if (!result.rows[0]) {
        return false;
      }

      await database.query(
        `DELETE FROM admin_mfa_recovery_codes
         WHERE user_id=$1::bigint`,
        [
          userId,
        ],
      );
      await database.query(
        `DELETE FROM admin_mfa_challenges
         WHERE user_id=$1::bigint`,
        [
          userId,
        ],
      );

      return true;
    },

    async replaceMfaRecoveryCodes(
      userId,
      codeHashes,
    ) {
      const client =
        typeof database.connect ===
          'function'
          ? await database.connect()
          : null;
      const target =
        client ??
        database;

      try {
        if (client) {
          await target.query(
            'BEGIN',
          );
        }

        await target.query(
          `DELETE FROM admin_mfa_recovery_codes
           WHERE user_id=$1::bigint`,
          [
            userId,
          ],
        );

        for (
          const hash of
          codeHashes
        ) {
          await target.query(
            `INSERT INTO admin_mfa_recovery_codes (
               user_id,
               code_hash
             )
             VALUES (
               $1::bigint,
               $2::bytea
             )`,
            [
              userId,
              hash,
            ],
          );
        }

        if (client) {
          await target.query(
            'COMMIT',
          );
        }
      } catch (error) {
        if (client) {
          await target.query(
            'ROLLBACK',
          );
        }
        throw error;
      } finally {
        client?.release();
      }
    },

    async countUnusedMfaRecoveryCodes(
      userId,
    ) {
      const result =
        await database.query(
          `SELECT COUNT(*)::integer AS count
           FROM admin_mfa_recovery_codes
           WHERE user_id=$1::bigint
             AND used_at IS NULL`,
          [
            userId,
          ],
        );

      return result.rows[0]
        ?.count ??
        0;
    },

    async consumeMfaRecoveryCode(
      userId,
      codeHash,
    ) {
      const result =
        await database.query(
          `UPDATE admin_mfa_recovery_codes
           SET used_at=NOW()
           WHERE user_id=$1::bigint
             AND code_hash=$2::bytea
             AND used_at IS NULL
           RETURNING id::integer AS id`,
          [
            userId,
            codeHash,
          ],
        );

      return Boolean(
        result.rows[0],
      );
    },

    async advanceMfaStep(
      userId,
      step,
    ) {
      const result =
        await database.query(
          `UPDATE admin_users
           SET
             mfa_last_used_step=$2::bigint,
             updated_at=NOW()
           WHERE id=$1::bigint
             AND mfa_enabled
             AND (
               mfa_last_used_step IS NULL
               OR mfa_last_used_step < $2::bigint
             )
           RETURNING id::integer AS id`,
          [
            userId,
            step,
          ],
        );

      return Boolean(
        result.rows[0],
      );
    },

    async createMfaChallenge({
      tokenHash,
      userId,
      expiresAt,
      ipAddress,
      userAgent,
    }) {
      await database.query(
        `INSERT INTO admin_mfa_challenges (
           token_hash,
           user_id,
           expires_at,
           ip_address,
           user_agent
         )
         VALUES (
           $1::bytea,
           $2::bigint,
           $3::timestamptz,
           $4::inet,
           $5::text
         )`,
        [
          tokenHash,
          userId,
          expiresAt,
          ipAddress ??
          null,
          userAgent ??
          null,
        ],
      );
    },

    async consumeMfaChallenge(
      tokenHash,
    ) {
      const result =
        await database.query(
          `DELETE FROM admin_mfa_challenges
           WHERE token_hash=$1::bytea
             AND expires_at > NOW()
           RETURNING
             user_id::integer AS "userId",
             ip_address::text AS "ipAddress",
             user_agent AS "userAgent"`,
          [
            tokenHash,
          ],
        );

      return result.rows[0] ??
        null;
    },

    async purgeExpiredMfaChallenges() {
      const result =
        await database.query(
          `DELETE FROM admin_mfa_challenges
           WHERE expires_at <= NOW()`,
        );

      return result.rowCount ??
        0;
    },
  };
}
