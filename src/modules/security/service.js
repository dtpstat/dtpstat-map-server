import {
  createSecurityAccountService,
} from './account-service.js';
import {
  createSecurityAdministrationService,
} from './admin-service.js';
import {
  createSecurityAuditService,
} from './audit-service.js';
import {
  createSecurityAuthService,
} from './auth-service.js';

/**
 * Compatibility application façade for admin security.
 *
 * The public service shape stays stable while authentication, account
 * management, security administration and audit evolve independently.
 */
export function createAdminSecurityService(repository) {
  const audit =
    createSecurityAuditService(repository);

  const authentication =
    createSecurityAuthService(
      repository,
      {
        appendAudit: audit.appendAudit,
      },
    );

  const accounts =
    createSecurityAccountService(
      repository,
      {
        appendAudit: audit.appendAudit,
      },
    );

  const administration =
    createSecurityAdministrationService(
      repository,
    );

  return {
    ...authentication,
    ...accounts,
    ...administration,
    ...audit,
  };
}
