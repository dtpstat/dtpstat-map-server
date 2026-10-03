import crypto from 'node:crypto';
import {
  adminPasswordPolicy,
  AdminSecurityValidationError,
  integerField,
  isLoopbackAdminIp,
  normalizeAdminDurationSeconds,
  normalizeAdminIp,
  normalizeAdminNetwork,
  normalizeAdminReason,
  normalizeAdminSecuritySettings,
} from './policy.js';

function metricsTokenHash(
  token,
) {
  return crypto
    .createHash(
      'sha256',
    )
    .update(
      token,
      'utf8',
    )
    .digest();
}

function metricsTokenMatches(
  token,
  tokenHash,
) {
  if (
    typeof token !== 'string' ||
    !token ||
    !Buffer.isBuffer(
      tokenHash,
    )
  ) {
    return false;
  }

  const actual =
    metricsTokenHash(
      token,
    );

  return (
    actual.length ===
      tokenHash.length &&
    crypto.timingSafeEqual(
      actual,
      tokenHash,
    )
  );
}

export function createSecurityAdministrationService(
  repository,
  {
    mfaAvailable = false,
  } = {},
) {
  async function createIpBlock(
    payload,
    actor,
    actorIp,
  ) {
    if (
      !payload ||
      typeof payload !== 'object' ||
      Array.isArray(payload)
    ) {
      throw new AdminSecurityValidationError(
        'Request body must be a JSON object',
      );
    }

    const ipAddress =
      normalizeAdminIp(payload.ipAddress);

    if (!ipAddress) {
      throw new AdminSecurityValidationError(
        'ipAddress is required',
      );
    }

    if (
      isLoopbackAdminIp(
        ipAddress,
      )
    ) {
      throw new AdminSecurityValidationError(
        'Loopback IP addresses cannot be blocked',
      );
    }

    if (
      ipAddress ===
      normalizeAdminIp(actorIp)
    ) {
      throw new AdminSecurityValidationError(
        'You cannot block the IP address of your current session',
      );
    }

    const allowlistMatch =
      await repository
        .findIpAllowlistMatch(
          ipAddress,
        );

    if (allowlistMatch) {
      throw new AdminSecurityValidationError(
        'This IP address is protected by the allowlist',
      );
    }

    const durationSeconds =
      normalizeAdminDurationSeconds(
        payload.durationSeconds,
      );

    return repository.createIpBlock({
      ipAddress,
      expiresAt:
        durationSeconds
          ? new Date(
            Date.now() +
            durationSeconds * 1000,
          ).toISOString()
          : null,
      blockedBy: actor?.id ?? null,
      reason:
        normalizeAdminReason(payload.reason),
      sourceAuditId:
        (
          payload.sourceAuditId === null ||
          payload.sourceAuditId === undefined
        )
          ? null
          : integerField(
            payload.sourceAuditId,
            'sourceAuditId',
            1,
            Number.MAX_SAFE_INTEGER,
          ),
    });
  }

  async function createIpAllowlistEntry(
    payload,
    actor,
  ) {
    if (
      !payload ||
      typeof payload !== 'object' ||
      Array.isArray(payload)
    ) {
      throw new AdminSecurityValidationError(
        'Request body must be a JSON object',
      );
    }

    const network =
      normalizeAdminNetwork(
        payload.network,
      );

    const entry =
      await repository
        .createIpAllowlistEntry({
          network,
          createdBy:
            actor?.id ??
            null,
          reason:
            normalizeAdminReason(
              payload.reason,
            ),
        });

    await repository
      .clearIpSecurityForNetwork(
        entry.network,
      );

    return entry;
  }

  async function saveSecuritySettings(payload) {
    const normalized =
      normalizeAdminSecuritySettings(
        payload,
      );

    if (
      normalized.mfaRequired &&
      !mfaAvailable
    ) {
      throw new AdminSecurityValidationError(
        'Configure ADMIN_MFA_ENCRYPTION_KEY before requiring MFA',
      );
    }

    if (
      normalized.metricsEnabled
    ) {
      const access =
        await repository
          .getMetricsAccess();

      if (
        !Buffer.isBuffer(
          access.tokenHash,
        )
      ) {
        throw new AdminSecurityValidationError(
          'Configure a Prometheus bearer token before enabling metrics',
        );
      }
    }

    const settings =
      await repository.saveSecuritySettings(
        normalized,
      );

    await repository.purgeAudit(
      settings.auditRetentionDays,
    );

    return settings;
  }

  async function bootstrapMetricsSettings(
    options = {},
  ) {
    const bearerToken =
      typeof options
        .bearerToken ===
        'string' &&
      options.bearerToken
        ? options.bearerToken
        : null;
    const tokenHash =
      bearerToken
        ? metricsTokenHash(
            bearerToken,
          )
        : null;

    const access =
      await repository
        .initializeMetricsSettings({
          enabled:
            Boolean(
              options.enabled &&
              tokenHash,
            ),
          tokenHash,
        });

    return {
      initializedFromEnvironment:
        access
          .initializedFromEnvironment,
      enabled:
        Boolean(
          access.enabled,
        ),
      tokenConfigured:
        Buffer.isBuffer(
          access.tokenHash,
        ),
    };
  }

  async function authorizeMetricsToken(
    token,
  ) {
    const access =
      await repository
        .getMetricsAccess();

    return {
      enabled:
        Boolean(
          access.enabled,
        ),
      authorized:
        Boolean(
          access.enabled &&
          metricsTokenMatches(
            token,
            access.tokenHash,
          ),
        ),
    };
  }

  async function rotateMetricsToken() {
    const token =
      crypto
        .randomBytes(
          32,
        )
        .toString(
          'base64url',
        );
    const settings =
      await repository
        .saveMetricsTokenHash(
          metricsTokenHash(
            token,
          ),
        );

    return {
      token,
      settings,
    };
  }

  async function clearMetricsToken() {
    return repository
      .clearMetricsToken();
  }

  return {
    getSecuritySettings: () =>
      repository.getSecuritySettings(),

    getPasswordPolicy: async () =>
      adminPasswordPolicy(
        await repository.getSecuritySettings(),
      ),

    saveSecuritySettings,
    bootstrapMetricsSettings,
    authorizeMetricsToken,
    rotateMetricsToken,
    clearMetricsToken,

    listIpBlocks: () =>
      repository.listIpBlocks(),

    createIpBlock,

    deleteIpBlock: (blockId) =>
      repository.deleteIpBlock(blockId),

    listIpAllowlist: () =>
      repository.listIpAllowlist(),

    createIpAllowlistEntry,

    deleteIpAllowlistEntry: (entryId) =>
      repository.deleteIpAllowlistEntry(
        entryId,
      ),
  };
}
