import {
  adminPasswordPolicy,
  AdminSecurityValidationError,
  integerField,
  normalizeAdminDurationSeconds,
  normalizeAdminIp,
  normalizeAdminReason,
  normalizeAdminSecuritySettings,
} from './policy.js';

export function createSecurityAdministrationService(
  repository,
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
      ipAddress ===
      normalizeAdminIp(actorIp)
    ) {
      throw new AdminSecurityValidationError(
        'You cannot block the IP address of your current session',
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

  async function saveSecuritySettings(payload) {
    const settings =
      await repository.saveSecuritySettings(
        normalizeAdminSecuritySettings(
          payload,
        ),
      );

    await repository.purgeAudit(
      settings.auditRetentionDays,
    );

    return settings;
  }

  return {
    getSecuritySettings: () =>
      repository.getSecuritySettings(),

    getPasswordPolicy: async () =>
      adminPasswordPolicy(
        await repository.getSecuritySettings(),
      ),

    saveSecuritySettings,

    listIpBlocks: () =>
      repository.listIpBlocks(),

    createIpBlock,

    deleteIpBlock: (blockId) =>
      repository.deleteIpBlock(blockId),
  };
}
