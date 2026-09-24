import {
  createAdminAccessControlRepository,
} from './admin-access-control-repository.js';
import {
  createAdminAuditRepository,
} from './admin-audit-repository.js';
import {
  createAdminSessionRepository,
} from './admin-session-repository.js';
import {
  createAdminUserRepository,
} from './admin-user-repository.js';

/**
 * Compatibility façade for admin security persistence.
 *
 * @param {{ query: Function }} database
 * @param {{
 *   users?: ReturnType<typeof createAdminUserRepository>,
 *   sessions?: ReturnType<typeof createAdminSessionRepository>,
 *   accessControl?: ReturnType<typeof createAdminAccessControlRepository>,
 *   audit?: ReturnType<typeof createAdminAuditRepository>
 * }} [dependencies]
 */
export function createAdminSecurityRepository(
  database,
  dependencies = {},
) {
  const users =
    dependencies.users ?? createAdminUserRepository(database);
  const sessions =
    dependencies.sessions ?? createAdminSessionRepository(database);
  const accessControl =
    dependencies.accessControl ??
    createAdminAccessControlRepository(database);
  const audit =
    dependencies.audit ?? createAdminAuditRepository(database);

  return {
    ...users,
    ...sessions,
    ...accessControl,
    ...audit,
  };
}
