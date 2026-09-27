import {
  ADMIN_AVATAR_MAX_BYTES,
  ADMIN_AVATAR_MIMES,
  adminPasswordPolicy,
  AdminSecurityValidationError,
  booleanField,
  normalizeAdminDisplayName,
  normalizeAdminDurationSeconds,
  normalizeAdminEmail,
  normalizeAdminReason,
  normalizeAdminUsername,
  publicAdminUser,
} from './policy.js';
import {
  generateTemporaryPassword,
  hashAdminPassword,
  verifyAdminPassword,
} from './credentials.js';

function duplicateUsername(error) {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === '23505'
  );
}

export function createSecurityAccountService(
  repository,
  { appendAudit },
) {
  async function bootstrap({ username, password }) {
    if (await repository.countUsers() > 0) {
      return { created: false };
    }

    if (!username || !password) {
      throw new Error(
        'No administrator exists. Set IMPORT_API_USERNAME and ' +
        'IMPORT_API_PASSWORD for the first startup after the ' +
        'admin-security migrations.',
      );
    }

    const normalizedUsername =
      normalizeAdminUsername(username);
    const passwordHash =
      await hashAdminPassword(
        password,
        { bootstrap: true },
      );

    try {
      const user = await repository.createUser({
        username: normalizedUsername,
        displayName: normalizedUsername,
        email: null,
        passwordHash,
        canManageData: true,
        canManageInterface: true,
        canEditOsm: true,
        canEditGeometries: true,
        canManageUsers: true,
        canViewAudit: true,
        canManageSecurity: true,
        isSuperuser: true,
        isBootstrap: true,
        mustChangePassword: false,
      });

      await appendAudit({
        eventType: 'security',
        operationType: 'admin.bootstrap',
        status: 'succeeded',
        durationMs: null,
        userId: user.id,
        username: user.username,
        details: { source: 'environment' },
      });

      return {
        created: true,
        user: publicAdminUser(user),
      };
    } catch (error) {
      if (
        duplicateUsername(error) &&
        await repository.countUsers() > 0
      ) {
        return { created: false };
      }
      throw error;
    }
  }

  async function createUser(payload) {
    if (
      !payload ||
      typeof payload !== 'object' ||
      Array.isArray(payload)
    ) {
      throw new AdminSecurityValidationError(
        'Request body must be a JSON object',
      );
    }

    const allowed = new Set([
      'username',
      'displayName',
      'email',
      'password',
      'canManageData',
      'canManageInterface',
      'canEditOsm',
      'canEditGeometries',
      'canManageUsers',
      'canViewAudit',
      'canManageSecurity',
    ]);

    const unknown = Object.keys(payload)
      .filter((key) => !allowed.has(key));

    if (unknown.length) {
      throw new AdminSecurityValidationError(
        'Request body contains unsupported properties: ' +
        unknown.join(', '),
      );
    }

    const username =
      normalizeAdminUsername(payload.username);

    const policy = adminPasswordPolicy(
      await repository.getSecuritySettings(),
    );

    const temporaryPassword =
      payload.password
        ? null
        : generateTemporaryPassword(policy);

    const password =
      payload.password ?? temporaryPassword;

    const user = {
      username,
      displayName: normalizeAdminDisplayName(
        payload.displayName,
        username,
      ),
      email: normalizeAdminEmail(payload.email),
      passwordHash:
        await hashAdminPassword(
          password,
          { policy },
        ),
      canManageData: booleanField(
        payload.canManageData,
        'canManageData',
      ),
      canManageInterface: booleanField(
        payload.canManageInterface,
        'canManageInterface',
      ),
      canEditOsm: booleanField(
        payload.canEditOsm,
        'canEditOsm',
      ),
      canEditGeometries: booleanField(
        payload.canEditGeometries,
        'canEditGeometries',
      ),
      canManageUsers: booleanField(
        payload.canManageUsers,
        'canManageUsers',
      ),
      canViewAudit: booleanField(
        payload.canViewAudit,
        'canViewAudit',
      ),
      canManageSecurity: booleanField(
        payload.canManageSecurity,
        'canManageSecurity',
      ),
      isSuperuser: false,
      isBootstrap: false,
      mustChangePassword:
        Boolean(temporaryPassword),
    };

    try {
      const created = publicAdminUser(
        await repository.createUser(user),
      );
      return {
        user: created,
        temporaryPassword,
      };
    } catch (error) {
      if (duplicateUsername(error)) {
        throw new AdminSecurityValidationError(
          'A user with this username already exists',
        );
      }
      throw error;
    }
  }

  async function updateUser(userId, payload) {
    if (
      !payload ||
      typeof payload !== 'object' ||
      Array.isArray(payload)
    ) {
      throw new AdminSecurityValidationError(
        'Request body must be a JSON object',
      );
    }

    const allowed = new Set([
      'displayName',
      'email',
      'canManageData',
      'canManageInterface',
      'canEditOsm',
      'canEditGeometries',
      'canManageUsers',
      'canViewAudit',
      'canManageSecurity',
    ]);

    const unknown = Object.keys(payload)
      .filter((key) => !allowed.has(key));

    if (unknown.length) {
      throw new AdminSecurityValidationError(
        'Request body contains unsupported properties: ' +
        unknown.join(', '),
      );
    }

    const current =
      await repository.getUser(userId);

    if (!current) return null;

    const protectedUser =
      current.isBootstrap ||
      current.isSuperuser;

    const next = {
      ...current,
      displayName: normalizeAdminDisplayName(
        payload.displayName,
        current.displayName ??
        current.username,
      ),
      email:
        payload.email === undefined
          ? current.email
          : normalizeAdminEmail(payload.email),
      canManageData:
        protectedUser
          ? true
          : booleanField(
            payload.canManageData,
            'canManageData',
            current.canManageData,
          ),
      canManageInterface:
        protectedUser
          ? true
          : booleanField(
            payload.canManageInterface,
            'canManageInterface',
            current.canManageInterface,
          ),
      canEditOsm:
        protectedUser
          ? true
          : booleanField(
            payload.canEditOsm,
            'canEditOsm',
            current.canEditOsm,
          ),
      canEditGeometries:
        protectedUser
          ? true
          : booleanField(
            payload.canEditGeometries,
            'canEditGeometries',
            current.canEditGeometries,
          ),
      canManageUsers:
        protectedUser
          ? true
          : booleanField(
            payload.canManageUsers,
            'canManageUsers',
            current.canManageUsers,
          ),
      canViewAudit:
        protectedUser
          ? true
          : booleanField(
            payload.canViewAudit,
            'canViewAudit',
            current.canViewAudit,
          ),
      canManageSecurity:
        protectedUser
          ? true
          : booleanField(
            payload.canManageSecurity,
            'canManageSecurity',
            current.canManageSecurity,
          ),
    };

    return publicAdminUser(
      await repository.updateUser(
        userId,
        next,
      ),
    );
  }

  async function deleteUser(userId, actorId) {
    const current =
      await repository.getUser(userId);

    if (!current) return null;

    if (current.isBootstrap) {
      throw new AdminSecurityValidationError(
        'Bootstrap administrator cannot be deleted',
      );
    }

    if (userId === actorId) {
      throw new AdminSecurityValidationError(
        'You cannot delete your active account',
      );
    }

    await repository.revokeUserSessions(userId);

    return publicAdminUser(
      await repository.deleteUser(userId),
    );
  }

  async function resetTemporaryPassword(userId) {
    const current =
      await repository.getUser(userId);

    if (!current) return null;

    const policy = adminPasswordPolicy(
      await repository.getSecuritySettings(),
    );
    const temporaryPassword =
      generateTemporaryPassword(policy);
    const passwordHash =
      await hashAdminPassword(
        temporaryPassword,
        { policy },
      );

    const user =
      await repository.updatePassword(
        userId,
        passwordHash,
        true,
      );

    await repository.revokeUserSessions(userId);

    return {
      user: publicAdminUser(user),
      temporaryPassword,
    };
  }

  async function blockUser(
    userId,
    payload,
    actor,
  ) {
    const current =
      await repository.getUser(userId);

    if (!current) return null;

    if (current.isBootstrap) {
      throw new AdminSecurityValidationError(
        'Bootstrap administrator cannot be manually blocked',
      );
    }

    if (actor?.id === userId) {
      throw new AdminSecurityValidationError(
        'You cannot manually block your active account',
      );
    }

    const durationSeconds =
      normalizeAdminDurationSeconds(
        payload?.durationSeconds,
      );

    const now = new Date();

    const next = {
      ...current,
      isBlocked: true,
      manualBlockedAt: now.toISOString(),
      manualBlockedUntil:
        durationSeconds
          ? new Date(
            now.valueOf() +
            durationSeconds * 1000,
          ).toISOString()
          : null,
      manualBlockReason:
        normalizeAdminReason(payload?.reason),
      manualBlockedBy:
        actor?.id ?? null,
    };

    const user =
      await repository.updateUser(
        userId,
        next,
      );

    await repository.revokeUserSessions(userId);

    return publicAdminUser(user);
  }

  async function unblockUser(userId) {
    const current =
      await repository.getUser(userId);

    if (!current) return null;

    return publicAdminUser(
      await repository.updateUser(
        userId,
        {
          ...current,
          isBlocked: false,
          manualBlockedAt: null,
          manualBlockedUntil: null,
          manualBlockReason: null,
          manualBlockedBy: null,
        },
      ),
    );
  }

  async function updateOwnProfile(
    userId,
    payload,
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

    const unknown = Object.keys(payload)
      .filter(
        (key) =>
          ![
            'displayName',
            'email',
          ].includes(key),
      );

    if (unknown.length) {
      throw new AdminSecurityValidationError(
        'Request body contains unsupported properties: ' +
        unknown.join(', '),
      );
    }

    const current =
      await repository.getUser(userId);

    if (!current) return null;

    return publicAdminUser(
      await repository.updateProfile(
        userId,
        {
          displayName:
            normalizeAdminDisplayName(
              payload.displayName,
              current.displayName ??
              current.username,
            ),
          email:
            payload.email === undefined
              ? current.email
              : normalizeAdminEmail(
                payload.email,
              ),
        },
      ),
    );
  }

  async function changeOwnPassword(
    userId,
    payload,
    currentSessionId = null,
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

    const unknown = Object.keys(payload)
      .filter(
        (key) =>
          ![
            'currentPassword',
            'newPassword',
          ].includes(key),
      );

    if (unknown.length) {
      throw new AdminSecurityValidationError(
        'Request body contains unsupported properties: ' +
        unknown.join(', '),
      );
    }

    const current =
      await repository.getAuthUser(userId);

    if (!current) return null;

    if (
      !await verifyAdminPassword(
        payload.currentPassword,
        current.passwordHash,
      )
    ) {
      throw new AdminSecurityValidationError(
        'Current password is incorrect',
      );
    }

    const policy = adminPasswordPolicy(
      await repository.getSecuritySettings(),
    );

    const passwordHash =
      await hashAdminPassword(
        payload.newPassword,
        { policy },
      );

    const user =
      await repository.updatePassword(
        userId,
        passwordHash,
        false,
      );

    await repository.revokeUserSessions(
      userId,
      currentSessionId,
    );

    return publicAdminUser(user);
  }

  async function saveAvatar(
    userId,
    mime,
    data,
  ) {
    if (!ADMIN_AVATAR_MIMES.has(mime)) {
      throw new AdminSecurityValidationError(
        'Avatar must be PNG, JPEG or WebP',
      );
    }

    if (
      !Buffer.isBuffer(data) ||
      data.length < 1 ||
      data.length > ADMIN_AVATAR_MAX_BYTES
    ) {
      throw new AdminSecurityValidationError(
        `Avatar must contain 1-${ADMIN_AVATAR_MAX_BYTES} bytes`,
      );
    }

    return publicAdminUser(
      await repository.saveAvatar(
        userId,
        mime,
        data,
      ),
    );
  }

  return {
    bootstrap,
    listUsers: () =>
      repository.listUsers()
        .then(
          (users) =>
            users.map(publicAdminUser),
        ),
    createUser,
    updateUser,
    deleteUser,
    resetTemporaryPassword,
    blockUser,
    unblockUser,
    updateOwnProfile,
    changeOwnPassword,
    getAvatar: (userId) =>
      repository.getAvatar(userId),
    saveAvatar,
    clearAvatar: (userId) =>
      repository.clearAvatar(userId)
        .then(publicAdminUser),
    listUserSessions: (userId) =>
      repository.listUserSessions(userId),
    revokeSession: (userId, sessionId) =>
      repository.revokeSessionById(
        userId,
        sessionId,
      ),
    revokeOtherSessions: (
      userId,
      sessionId,
    ) =>
      repository.revokeUserSessions(
        userId,
        sessionId,
      ),
  };
}
