import {
  normalizeAdminIp,
} from './policy.js';

export function createSecurityAuditService(repository) {
  async function appendAudit(entry) {
    return repository.appendAudit({
      ...entry,
      ipAddress: normalizeAdminIp(entry.ipAddress),
    });
  }

  return {
    appendAudit,
    listAudit: (options) =>
      repository.listAudit(options),
    auditFacets: () =>
      repository.auditFacets(),
  };
}
