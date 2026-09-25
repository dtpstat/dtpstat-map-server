import {
  createAdminAccessControlRepository,
} from '../db/admin-access-control-repository.js';
import {
  createAdminAuditRepository,
} from '../db/admin-audit-repository.js';
import {
  createAdminSessionRepository,
} from '../db/admin-session-repository.js';
import {
  createAdminUserRepository,
} from '../db/admin-user-repository.js';
import {
  createAdminAuthorization,
} from '../http/admin-auth.js';
import {
  createAdminSecurityService,
} from '../modules/security/service.js';

export function createAdminSecurityPersistence(
  database,
  dependencies = {},
) {
  const users =
    dependencies.users ??
    createAdminUserRepository(
      database,
    );
  const sessions =
    dependencies.sessions ??
    createAdminSessionRepository(
      database,
    );
  const accessControl =
    dependencies.accessControl ??
    createAdminAccessControlRepository(
      database,
    );
  const audit =
    dependencies.audit ??
    createAdminAuditRepository(
      database,
    );

  return {
    ...users,
    ...sessions,
    ...accessControl,
    ...audit,
  };
}

/**
 * Compose admin security persistence, security use cases and HTTP
 * authorization as one application subsystem.
 */
export function createSecurityRuntime(
  database,
  dependencies = {},
) {
  const repository =
    dependencies.repository ??
    createAdminSecurityPersistence(
      database,
      dependencies.persistence,
    );

  const securityService =
    dependencies.securityService ??
    createAdminSecurityService(
      repository,
    );

  const adminAuth =
    dependencies.adminAuth ??
    createAdminAuthorization(
      securityService,
    );

  return {
    securityService,
    adminAuth,
  };
}
