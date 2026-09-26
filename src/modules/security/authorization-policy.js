/**
 * Authorization policy for administrator capabilities.
 *
 * @param {any} user
 * @param {'any'|'profile'|'data'|'interface'|'osm-editor'|'geometry-editor'|'users'|'audit'|'users-or-audit'|'security'|'superuser'} permission
 */
export function adminHasPermission(user, permission) {
  if (!user) return false;
  if (user.isSuperuser) return true;

  if (
    permission === 'any' ||
    permission === 'profile'
  ) {
    return true;
  }

  if (permission === 'data') {
    return Boolean(user.canManageData);
  }
  if (permission === 'interface') {
    return Boolean(user.canManageInterface);
  }
  if (permission === 'osm-editor') {
    return Boolean(user.canEditOsm);
  }
  if (permission === 'geometry-editor') {
    return Boolean(user.canEditGeometries);
  }
  if (permission === 'users') {
    return Boolean(user.canManageUsers);
  }
  if (permission === 'audit') {
    return Boolean(user.canViewAudit);
  }
  if (permission === 'users-or-audit') {
    return Boolean(
      user.canManageUsers ||
      user.canViewAudit,
    );
  }
  if (permission === 'security') {
    return Boolean(user.canManageSecurity);
  }

  // Superuser-only routes are already handled by the early isSuperuser check.
  if (permission === 'superuser') {
    return false;
  }

  return false;
}
