export const DEFAULT_ADMIN_PASSWORD_POLICY = Object.freeze({
  passwordMinLength: 12,
  passwordMaxLength: 1024,
  passwordRequireLowercase: false,
  passwordRequireUppercase: false,
  passwordRequireDigit: false,
  passwordRequireSpecial: false,
});

export const ADMIN_AVATAR_MAX_BYTES = 256 * 1024;
export const ADMIN_AVATAR_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
]);

export class AdminSecurityValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AdminSecurityValidationError';
  }
}

export function normalizeAdminUsername(value) {
  if (typeof value !== 'string') {
    throw new AdminSecurityValidationError(
      'username must be a string',
    );
  }
  const username = value
    .trim()
    .replace(/\s+/g, ' ')
    .normalize('NFC');

  if (!username || username.length > 64) {
    throw new AdminSecurityValidationError(
      'username must contain between 1 and 64 characters',
    );
  }
  if (
    username.includes(':') ||
    /[\u0000-\u001f\u007f]/.test(username)
  ) {
    throw new AdminSecurityValidationError(
      'username contains unsupported characters',
    );
  }
  return username;
}

export function normalizeAdminDisplayName(
  value,
  fallback = null,
) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return fallback;
  }
  if (typeof value !== 'string') {
    throw new AdminSecurityValidationError(
      'displayName must be a string or null',
    );
  }

  const displayName = value
    .trim()
    .replace(/\s+/g, ' ')
    .normalize('NFC');

  if (!displayName || displayName.length > 160) {
    throw new AdminSecurityValidationError(
      'displayName must contain between 1 and 160 characters',
    );
  }
  return displayName;
}

export function normalizeAdminEmail(value) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new AdminSecurityValidationError(
      'email must be a string or null',
    );
  }

  const email = value
    .trim()
    .toLocaleLowerCase('en-US');

  if (
    email.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new AdminSecurityValidationError(
      'email must contain a valid address up to 320 characters',
    );
  }
  return email;
}

export function adminPasswordPolicy(settings = {}) {
  return {
    passwordMinLength:
      settings.passwordMinLength ??
      DEFAULT_ADMIN_PASSWORD_POLICY.passwordMinLength,
    passwordMaxLength:
      settings.passwordMaxLength ??
      DEFAULT_ADMIN_PASSWORD_POLICY.passwordMaxLength,
    passwordRequireLowercase:
      settings.passwordRequireLowercase ??
      DEFAULT_ADMIN_PASSWORD_POLICY.passwordRequireLowercase,
    passwordRequireUppercase:
      settings.passwordRequireUppercase ??
      DEFAULT_ADMIN_PASSWORD_POLICY.passwordRequireUppercase,
    passwordRequireDigit:
      settings.passwordRequireDigit ??
      DEFAULT_ADMIN_PASSWORD_POLICY.passwordRequireDigit,
    passwordRequireSpecial:
      settings.passwordRequireSpecial ??
      DEFAULT_ADMIN_PASSWORD_POLICY.passwordRequireSpecial,
  };
}

export function normalizeAdminPassword(
  value,
  { bootstrap = false, policy = null } = {},
) {
  if (typeof value !== 'string') {
    throw new AdminSecurityValidationError(
      'password must be a string',
    );
  }

  if (bootstrap) {
    if (!value.length) {
      throw new AdminSecurityValidationError(
        'bootstrap password must not be empty',
      );
    }
    return value;
  }

  const rules = adminPasswordPolicy(policy ?? {});
  if (
    value.length < rules.passwordMinLength ||
    value.length > rules.passwordMaxLength
  ) {
    throw new AdminSecurityValidationError(
      `password must contain between ${rules.passwordMinLength} and ${rules.passwordMaxLength} characters`,
    );
  }
  if (
    rules.passwordRequireLowercase &&
    !/\p{Ll}/u.test(value)
  ) {
    throw new AdminSecurityValidationError(
      'password must contain a lowercase letter',
    );
  }
  if (
    rules.passwordRequireUppercase &&
    !/\p{Lu}/u.test(value)
  ) {
    throw new AdminSecurityValidationError(
      'password must contain an uppercase letter',
    );
  }
  if (
    rules.passwordRequireDigit &&
    !/\p{N}/u.test(value)
  ) {
    throw new AdminSecurityValidationError(
      'password must contain a digit',
    );
  }
  if (
    rules.passwordRequireSpecial &&
    !/[^\p{L}\p{N}]/u.test(value)
  ) {
    throw new AdminSecurityValidationError(
      'password must contain a special character',
    );
  }
  return value;
}

export function booleanField(
  value,
  name,
  fallback = false,
) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') {
    throw new AdminSecurityValidationError(
      `${name} must be boolean`,
    );
  }
  return value;
}

export function integerField(value, name, min, max) {
  if (
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    throw new AdminSecurityValidationError(
      `${name} must be an integer between ${min} and ${max}`,
    );
  }
  return value;
}

export function normalizeAdminSecuritySettings(payload) {
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
    'maxFailedAttempts',
    'failureWindowSeconds',
    'lockoutSeconds',
    'ipMaxFailedAttempts',
    'ipFailureWindowSeconds',
    'ipLockoutSeconds',
    'sessionIdleSeconds',
    'sessionAbsoluteSeconds',
    'auditRetentionDays',
    'passwordMinLength',
    'passwordMaxLength',
    'passwordRequireLowercase',
    'passwordRequireUppercase',
    'passwordRequireDigit',
    'passwordRequireSpecial',
  ]);

  const unknown = Object.keys(payload)
    .filter((key) => !allowed.has(key));

  if (unknown.length > 0) {
    throw new AdminSecurityValidationError(
      'Request body contains unsupported properties: ' +
        unknown.join(', '),
    );
  }

  const normalized = {
    maxFailedAttempts: integerField(
      payload.maxFailedAttempts,
      'maxFailedAttempts',
      1,
      100,
    ),
    failureWindowSeconds: integerField(
      payload.failureWindowSeconds,
      'failureWindowSeconds',
      10,
      86400,
    ),
    lockoutSeconds: integerField(
      payload.lockoutSeconds,
      'lockoutSeconds',
      10,
      604800,
    ),
    ipMaxFailedAttempts: integerField(
      payload.ipMaxFailedAttempts,
      'ipMaxFailedAttempts',
      1,
      1000,
    ),
    ipFailureWindowSeconds: integerField(
      payload.ipFailureWindowSeconds,
      'ipFailureWindowSeconds',
      10,
      86400,
    ),
    ipLockoutSeconds: integerField(
      payload.ipLockoutSeconds,
      'ipLockoutSeconds',
      10,
      604800,
    ),
    sessionIdleSeconds: integerField(
      payload.sessionIdleSeconds,
      'sessionIdleSeconds',
      60,
      86400,
    ),
    sessionAbsoluteSeconds: integerField(
      payload.sessionAbsoluteSeconds,
      'sessionAbsoluteSeconds',
      300,
      2592000,
    ),
    auditRetentionDays: integerField(
      payload.auditRetentionDays,
      'auditRetentionDays',
      0,
      3650,
    ),
    passwordMinLength: integerField(
      payload.passwordMinLength,
      'passwordMinLength',
      1,
      4096,
    ),
    passwordMaxLength: integerField(
      payload.passwordMaxLength,
      'passwordMaxLength',
      1,
      4096,
    ),
    passwordRequireLowercase: booleanField(
      payload.passwordRequireLowercase,
      'passwordRequireLowercase',
    ),
    passwordRequireUppercase: booleanField(
      payload.passwordRequireUppercase,
      'passwordRequireUppercase',
    ),
    passwordRequireDigit: booleanField(
      payload.passwordRequireDigit,
      'passwordRequireDigit',
    ),
    passwordRequireSpecial: booleanField(
      payload.passwordRequireSpecial,
      'passwordRequireSpecial',
    ),
  };

  if (
    normalized.passwordMinLength >
    normalized.passwordMaxLength
  ) {
    throw new AdminSecurityValidationError(
      'passwordMinLength must not exceed passwordMaxLength',
    );
  }

  const requiredClasses = [
    normalized.passwordRequireLowercase,
    normalized.passwordRequireUppercase,
    normalized.passwordRequireDigit,
    normalized.passwordRequireSpecial,
  ].filter(Boolean).length;

  if (
    normalized.passwordMaxLength <
    requiredClasses
  ) {
    throw new AdminSecurityValidationError(
      'passwordMaxLength is too small for the selected character requirements',
    );
  }

  return normalized;
}

export function publicAdminUser(user) {
  if (!user) return null;

  return {
    id: user.id,
    username: user.username,
    displayName:
      user.displayName ?? user.username,
    email: user.email ?? null,
    canManageData: Boolean(user.canManageData),
    canManageInterface: Boolean(
      user.canManageInterface,
    ),
    canEditOsm: Boolean(user.canEditOsm),
    canManageUsers: Boolean(user.canManageUsers),
    canViewAudit: Boolean(user.canViewAudit),
    canManageSecurity: Boolean(
      user.canManageSecurity,
    ),
    isSuperuser: Boolean(user.isSuperuser),
    isBootstrap: Boolean(user.isBootstrap),
    isBlocked: Boolean(user.isBlocked),
    manualBlockedAt: user.manualBlockedAt ?? null,
    manualBlockedUntil:
      user.manualBlockedUntil ?? null,
    manualBlockReason:
      user.manualBlockReason ?? null,
    mustChangePassword: Boolean(
      user.mustChangePassword,
    ),
    hasAvatar: Boolean(user.hasAvatar),
    avatarMime: user.avatarMime ?? null,
    lockedUntil: user.lockedUntil ?? null,
    lastLoginAt: user.lastLoginAt ?? null,
    passwordChangedAt:
      user.passwordChangedAt ?? null,
    createdAt: user.createdAt ?? null,
    updatedAt: user.updatedAt ?? null,
  };
}

export function normalizeAdminIp(value) {
  const text =
    typeof value === 'string'
      ? value.trim()
      : '';

  if (!text) return null;

  return (
    text.startsWith('::ffff:')
      ? text.slice(7)
      : text
  ).slice(0, 128);
}

export function secondsUntil(
  timestamp,
  now = new Date(),
) {
  if (!timestamp) return null;

  const target = new Date(timestamp);
  if (
    !Number.isFinite(target.valueOf()) ||
    target <= now
  ) {
    return null;
  }

  return Math.max(
    1,
    Math.ceil(
      (target.valueOf() - now.valueOf()) / 1000,
    ),
  );
}

export function normalizeAdminReason(value) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new AdminSecurityValidationError(
      'reason must be a string or null',
    );
  }

  const reason = value.trim();
  if (reason.length > 500) {
    throw new AdminSecurityValidationError(
      'reason must be at most 500 characters',
    );
  }

  return reason || null;
}

export function normalizeAdminDurationSeconds(value) {
  if (
    value === undefined ||
    value === null ||
    value === 0
  ) {
    return null;
  }

  return integerField(
    value,
    'durationSeconds',
    60,
    31536000,
  );
}
