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
import {
  createSecurityMfaService,
} from './mfa-service.js';

/**
 * Compatibility application façade for admin security.
 *
 * The public service shape stays stable while authentication, account
 * management, security administration and audit evolve independently.
 */
export function createAdminSecurityService(
  repository,
  options = {},
) {
  const audit =
    createSecurityAuditService(repository);

  const authentication =
    createSecurityAuthService(
      repository,
      {
        appendAudit:
          audit.appendAudit,
        mfaEncryptionKey:
          options
            .mfaEncryptionKey ??
          null,
      },
    );

  const mfa =
    createSecurityMfaService(
      repository,
      {
        appendAudit:
          audit.appendAudit,
        mfaEncryptionKey:
          options
            .mfaEncryptionKey ??
          null,
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
    ...mfa,
    ...accounts,
    ...administration,
    ...audit,
  };
}
