import {
  createAdminAuditChangeSet,
  sanitizeAdminAuditData,
} from '../shared/logging/admin-audit-details.js';
import {
  requestClientIp,
} from '../shared/http/client-ip.js';
import { serviceLog } from '../service-log.js';

const AUDIT_CHANGES_LOCAL =
  'dtpstatAdminAuditChanges';
const AUDIT_DETAILS_LOCAL =
  'dtpstatAdminAuditDetails';

export function recordAdminOperationChanges(
  response,
  before,
  after,
  options = {},
) {
  response.locals ??= {};

  const changeSet =
    createAdminAuditChangeSet(
      before,
      after,
      options,
    );

  response.locals[
    AUDIT_CHANGES_LOCAL
  ] = changeSet;

  return changeSet;
}

export function recordAdminOperationDetails(
  response,
  details,
) {
  response.locals ??= {};

  const current =
    response.locals[
      AUDIT_DETAILS_LOCAL
    ] ?? {};

  response.locals[
    AUDIT_DETAILS_LOCAL
  ] = {
    ...current,
    ...sanitizeAdminAuditData(
      details ?? {},
    ),
  };
}

function mayRecordConcreteChanges(
  operationType,
) {
  return (
    !operationType.startsWith(
      'security.',
    ) &&
    !operationType.startsWith(
      'profile.',
    )
  );
}

export function createAdminOperationAudit(
  securityService,
  operationType,
) {
  return function auditAdminOperation(
    request,
    response,
    next,
  ) {
    const startedAt = Date.now();
    let recorded = false;

    const record = () => {
      if (
        recorded ||
        !request.adminUser
      ) {
        return;
      }

      recorded = true;

      const status =
        response.statusCode >= 200 &&
        response.statusCode < 400
          ? 'succeeded'
          : 'failed';

      const allowChanges =
        mayRecordConcreteChanges(
          operationType,
        );

      const changeSet =
        allowChanges
          ? response.locals?.[
            AUDIT_CHANGES_LOCAL
          ]
          : null;

      const extraDetails =
        allowChanges
          ? response.locals?.[
            AUDIT_DETAILS_LOCAL
          ]
          : null;

      const details = {
        method: request.method,
        path: request.originalUrl,
        statusCode: response.statusCode,
        ...(extraDetails ?? {}),
        ...(changeSet?.changes?.length
          ? {
            changes:
              changeSet.changes,
          }
          : {}),
        ...(changeSet?.changesTruncated
          ? {
            changesTruncated: true,
          }
          : {}),
      };

      const durationMs =
        Math.max(
          0,
          Date.now() - startedAt,
        );

      const ipAddress =
        requestClientIp(request);

      serviceLog(
        status === 'succeeded'
          ? 'info'
          : 'warning',
        'admin.operation',
        {
          operationType,
          status,
          durationMs,
          ipAddress,
          userId:
            request.adminUser.id,
          username:
            request.adminUser.username,
          ...details,
        },
      );

      void securityService
        .appendAudit({
          eventType: 'operation',
          operationType,
          status,
          durationMs,
          ipAddress,
          userId:
            request.adminUser.id,
          username:
            request.adminUser.username,
          details,
        })
        .catch(
          (error) =>
            console.error(
              'Admin audit write failed',
              error,
            ),
        );
    };

    response.once('finish', record);
    response.once('close', record);
    next();
  };
}
