import {
  AdminSecurityValidationError,
} from './policy.js';
import {
  verifyAdminPassword,
} from './credentials.js';
import {
  decryptMfaSecret,
  encryptMfaSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  recoveryCodeHash,
  totpProvisioningUri,
  verifyTotpCode,
} from './mfa.js';

const ENROLLMENT_TTL_MS =
  10 * 60 * 1000;
const RECOVERY_CODE_COUNT =
  10;

function requireObject(
  payload,
  allowed,
) {
  if (
    !payload ||
    typeof payload !==
      'object' ||
    Array.isArray(
      payload,
    )
  ) {
    throw new AdminSecurityValidationError(
      'Request body must be a JSON object',
    );
  }

  const unsupported =
    Object.keys(
      payload,
    ).filter(
      (key) =>
        !allowed.includes(
          key,
        ),
    );

  if (
    unsupported.length >
    0
  ) {
    throw new AdminSecurityValidationError(
      'Request body contains unsupported properties: ' +
      unsupported.join(
        ', ',
      ),
    );
  }
}

function requireEncryptionKey(
  value,
) {
  if (!value) {
    throw new AdminSecurityValidationError(
      'MFA is not available until ADMIN_MFA_ENCRYPTION_KEY is configured',
    );
  }

  return value;
}

async function verifyCurrentPassword(
  repository,
  userId,
  password,
) {
  const user =
    await repository
      .getAuthUser(
        userId,
      );

  if (!user) {
    return null;
  }

  if (
    !await verifyAdminPassword(
      password,
      user.passwordHash,
    )
  ) {
    throw new AdminSecurityValidationError(
      'Current password is incorrect',
    );
  }

  return user;
}

async function verifySecondFactor(
  repository,
  encryptionKey,
  userId,
  code,
) {
  const state =
    await repository
      .getMfaState(
        userId,
      );

  if (
    !state?.enabled ||
    !state
      .secretCiphertext
  ) {
    return null;
  }

  const value =
    String(
      code ??
      '',
    ).trim();

  if (
    /^\d{6}$/u.test(
      value,
    )
  ) {
    const secret =
      decryptMfaSecret(
        state
          .secretCiphertext,
        encryptionKey,
      );
    const verification =
      verifyTotpCode(
        secret,
        value,
        {
          lastUsedStep:
            state
              .lastUsedStep,
        },
      );

    if (
      verification.valid &&
      await repository
        .advanceMfaStep(
          userId,
          verification.step,
        )
    ) {
      return 'totp';
    }

    return null;
  }

  const hash =
    recoveryCodeHash(
      value,
    );

  if (
    hash &&
    await repository
      .consumeMfaRecoveryCode(
        userId,
        hash,
      )
  ) {
    return 'recovery';
  }

  return null;
}

export function createSecurityMfaService(
  repository,
  {
    appendAudit,
    mfaEncryptionKey = null,
  },
) {
  async function getMfaStatus(
    userId,
  ) {
    const state =
      await repository
        .getMfaState(
          userId,
        );

    if (!state) {
      return null;
    }

    const pendingAt =
      state.pendingCreatedAt
        ? new Date(
            state
              .pendingCreatedAt,
          )
        : null;
    const pending =
      Boolean(
        state
          .pendingSecretCiphertext &&
        pendingAt &&
        Number.isFinite(
          pendingAt.valueOf(),
        ) &&
        Date.now() -
          pendingAt.valueOf() <
          ENROLLMENT_TTL_MS
      );

    if (
      state
        .pendingSecretCiphertext &&
      !pending
    ) {
      await repository
        .clearMfaPendingSecret(
          userId,
        );
    }

    return {
      enabled:
        Boolean(
          state.enabled,
        ),
      available:
        Boolean(
          mfaEncryptionKey,
        ),
      enrolledAt:
        state.enrolledAt ??
        null,
      enrollmentPending:
        pending,
      recoveryCodesRemaining:
        state.enabled
          ? await repository
              .countUnusedMfaRecoveryCodes(
                userId,
              )
          : 0,
    };
  }

  async function beginMfaEnrollment(
    userId,
    payload,
  ) {
    requireObject(
      payload,
      [
        'currentPassword',
      ],
    );
    const encryptionKey =
      requireEncryptionKey(
        mfaEncryptionKey,
      );
    const user =
      await verifyCurrentPassword(
        repository,
        userId,
        payload
          .currentPassword,
      );

    if (!user) {
      return null;
    }

    const current =
      await repository
        .getMfaState(
          userId,
        );

    if (
      current?.enabled
    ) {
      throw new AdminSecurityValidationError(
        'MFA is already enabled',
      );
    }

    const secret =
      generateTotpSecret();
    const saved =
      await repository
        .saveMfaPendingSecret(
          userId,
          encryptMfaSecret(
            secret,
            encryptionKey,
          ),
        );

    if (!saved) {
      return null;
    }

    const pendingAt =
      new Date(
        saved.pendingCreatedAt,
      );
    const expiresAt =
      new Date(
        pendingAt.valueOf() +
        ENROLLMENT_TTL_MS,
      ).toISOString();

    await appendAudit({
      eventType:
        'security',
      operationType:
        'profile.mfa.enroll.start',
      status:
        'succeeded',
      durationMs:
        null,
      userId,
      username:
        user.username,
      details: {
        expiresAt,
      },
    });

    return {
      secret,
      provisioningUri:
        totpProvisioningUri({
          secret,
          accountName:
            user.username,
          issuer:
            'DTP-Stat',
        }),
      expiresAt,
    };
  }

  async function confirmMfaEnrollment(
    userId,
    payload,
    currentSessionId =
      null,
  ) {
    requireObject(
      payload,
      [
        'code',
      ],
    );
    const encryptionKey =
      requireEncryptionKey(
        mfaEncryptionKey,
      );
    const state =
      await repository
        .getMfaState(
          userId,
        );

    if (
      !state
        ?.pendingSecretCiphertext ||
      !state.pendingCreatedAt
    ) {
      throw new AdminSecurityValidationError(
        'No MFA enrollment is pending',
      );
    }

    const pendingAt =
      new Date(
        state
          .pendingCreatedAt,
      );

    if (
      !Number.isFinite(
        pendingAt.valueOf(),
      ) ||
      Date.now() -
        pendingAt.valueOf() >=
        ENROLLMENT_TTL_MS
    ) {
      await repository
        .clearMfaPendingSecret(
          userId,
        );
      throw new AdminSecurityValidationError(
        'MFA enrollment expired; start again',
      );
    }

    const secret =
      decryptMfaSecret(
        state
          .pendingSecretCiphertext,
        encryptionKey,
      );
    const verification =
      verifyTotpCode(
        secret,
        payload.code,
      );

    if (
      !verification.valid
    ) {
      throw new AdminSecurityValidationError(
        'Verification code is incorrect',
      );
    }

    const recoveryCodes =
      generateRecoveryCodes(
        RECOVERY_CODE_COUNT,
      );
    const codeHashes =
      recoveryCodes.map(
        (code) =>
          recoveryCodeHash(
            code,
          ),
      );
    const enabled =
      await repository
        .completeMfaEnrollment(
          userId,
          verification.step,
          codeHashes,
        );

    if (!enabled) {
      throw new AdminSecurityValidationError(
        'MFA enrollment is no longer pending',
      );
    }

    await repository
      .revokeUserSessions(
        userId,
        currentSessionId,
      );

    const user =
      await repository
        .getAuthUser(
          userId,
        );

    await appendAudit({
      eventType:
        'security',
      operationType:
        'profile.mfa.enable',
      status:
        'succeeded',
      durationMs:
        null,
      userId,
      username:
        user?.username ??
        null,
      details: {
        recoveryCodeCount:
          recoveryCodes
            .length,
      },
    });

    return {
      enabled: true,
      enrolledAt:
        enabled.enrolledAt,
      recoveryCodes,
      recoveryCodesRemaining:
        recoveryCodes.length,
    };
  }

  async function regenerateMfaRecoveryCodes(
    userId,
    payload,
  ) {
    requireObject(
      payload,
      [
        'currentPassword',
        'code',
      ],
    );
    const encryptionKey =
      requireEncryptionKey(
        mfaEncryptionKey,
      );
    const user =
      await verifyCurrentPassword(
        repository,
        userId,
        payload
          .currentPassword,
      );

    if (!user) {
      return null;
    }

    const factor =
      await verifySecondFactor(
        repository,
        encryptionKey,
        userId,
        payload.code,
      );

    if (!factor) {
      throw new AdminSecurityValidationError(
        'Verification code is incorrect',
      );
    }

    const recoveryCodes =
      generateRecoveryCodes(
        RECOVERY_CODE_COUNT,
      );

    await repository
      .replaceMfaRecoveryCodes(
        userId,
        recoveryCodes.map(
          (code) =>
            recoveryCodeHash(
              code,
            ),
        ),
      );

    await appendAudit({
      eventType:
        'security',
      operationType:
        'profile.mfa.recovery.rotate',
      status:
        'succeeded',
      durationMs:
        null,
      userId,
      username:
        user.username,
      details: {
        method:
          factor,
        recoveryCodeCount:
          recoveryCodes
            .length,
      },
    });

    return {
      recoveryCodes,
      recoveryCodesRemaining:
        recoveryCodes.length,
    };
  }

  async function disableOwnMfa(
    userId,
    payload,
    currentSessionId =
      null,
  ) {
    requireObject(
      payload,
      [
        'currentPassword',
        'code',
      ],
    );
    const encryptionKey =
      requireEncryptionKey(
        mfaEncryptionKey,
      );
    const user =
      await verifyCurrentPassword(
        repository,
        userId,
        payload
          .currentPassword,
      );

    if (!user) {
      return null;
    }

    const factor =
      await verifySecondFactor(
        repository,
        encryptionKey,
        userId,
        payload.code,
      );

    if (!factor) {
      throw new AdminSecurityValidationError(
        'Verification code is incorrect',
      );
    }

    if (
      !await repository
        .disableMfa(
          userId,
        )
    ) {
      return null;
    }

    await repository
      .revokeUserSessions(
        userId,
        currentSessionId,
      );

    await appendAudit({
      eventType:
        'security',
      operationType:
        'profile.mfa.disable',
      status:
        'succeeded',
      durationMs:
        null,
      userId,
      username:
        user.username,
      details: {
        method:
          factor,
      },
    });

    return {
      enabled: false,
      recoveryCodesRemaining:
        0,
    };
  }

  return {
    getMfaStatus,
    beginMfaEnrollment,
    confirmMfaEnrollment,
    regenerateMfaRecoveryCodes,
    disableOwnMfa,
  };
}
