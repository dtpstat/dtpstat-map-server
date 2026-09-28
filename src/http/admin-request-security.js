import {
  requestClientIp,
} from '../shared/http/client-ip.js';
import {
  securityLog,
} from '../service-log.js';

const RESERVED_SECURITY_KEYS =
  new Set([
    'userid',
    'adminuserid',
    'currentuserid',
    'authuserid',
    'role',
    'roles',
    'roleid',
    'roleir',
    'rolemode',
    'permission',
    'permissions',
    'issuperuser',
    'isbootstrap',
    'authmethod',
    'sessionid',
    'adminuser',
    'canmanagedata',
    'canmanageinterface',
    'caneditosm',
    'caneditgeometries',
    'canmanageusers',
    'canviewaudit',
    'canmanagesecurity',
    'mustchangepassword',
    'passwordhash',
    'manualblockedby',
  ]);

const USER_MANAGEMENT_CAPABILITIES =
  new Set([
    'canmanagedata',
    'canmanageinterface',
    'caneditosm',
    'caneditgeometries',
    'canmanageusers',
    'canviewaudit',
    'canmanagesecurity',
  ]);

const RESERVED_HEADERS =
  new Set([
    'x-user-id',
    'x-admin-user-id',
    'x-current-user-id',
    'x-auth-user-id',
    'x-role',
    'x-role-id',
    'x-role-ir',
    'x-role-mode',
    'x-user-role',
    'x-admin-role',
    'x-permission',
    'x-permissions',
    'x-is-superuser',
    'x-is-bootstrap',
    'x-auth-method',
    'x-session-id',
    'x-admin-user',
    'x-can-manage-data',
    'x-can-manage-interface',
    'x-can-edit-osm',
    'x-can-edit-geometries',
    'x-can-manage-users',
    'x-can-view-audit',
    'x-can-manage-security',
  ]);

function normalizedKey(value) {
  return String(value)
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]/gu, '');
}

function requestPath(request) {
  return String(
    request.path ??
    request.originalUrl ??
    request.url ??
    '',
  ).split('?')[0];
}

function userManagementBody(request) {
  const method =
    String(
      request.method ??
      '',
    ).toUpperCase();
  const path =
    requestPath(request);

  return (
    (
      method === 'POST' &&
      path ===
        '/api/admin/security/users'
    ) ||
    (
      method === 'PATCH' &&
      /^\/api\/admin\/security\/users\/\d+$/u
        .test(path)
    )
  );
}

function sensitiveKey(
  key,
  request,
  source,
) {
  const normalized =
    normalizedKey(key);

  if (
    !RESERVED_SECURITY_KEYS
      .has(normalized)
  ) {
    return false;
  }

  if (
    source === 'body' &&
    userManagementBody(
      request,
    ) &&
    USER_MANAGEMENT_CAPABILITIES
      .has(normalized)
  ) {
    return false;
  }

  return true;
}

function uniqueFindings(findings) {
  const seen =
    new Set();

  return findings
    .filter(
      (finding) => {
        const key =
          finding.source +
          ':' +
          finding.key;
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      },
    )
    .slice(0, 32);
}

export function detectAdminTransportTampering(
  request,
) {
  const findings = [];

  for (
    const key of
    Object.keys(
      request.headers ??
      {},
    )
  ) {
    if (
      RESERVED_HEADERS.has(
        key.toLocaleLowerCase(
          'en-US',
        ),
      )
    ) {
      findings.push({
        source: 'header',
        key,
      });
    }
  }

  for (
    const key of
    Object.keys(
      request.query ??
      {},
    )
  ) {
    if (
      sensitiveKey(
        key,
        request,
        'query',
      )
    ) {
      findings.push({
        source: 'query',
        key,
      });
    }
  }

  return uniqueFindings(
    findings,
  );
}

export function detectAdminBodyTampering(
  request,
) {
  const body =
    request.body;

  if (
    !body ||
    typeof body !==
      'object' ||
    Array.isArray(body) ||
    Buffer.isBuffer(body)
  ) {
    return [];
  }

  return uniqueFindings(
    Object.keys(body)
      .filter(
        (key) =>
          sensitiveKey(
            key,
            request,
            'body',
          ),
      )
      .map(
        (key) => ({
          source: 'body',
          key,
        }),
      ),
  );
}

function auditStatus(event) {
  return event ===
    'admin.request.rejected'
    ? 'failed'
    : 'blocked';
}

export function installAdminRequestSecurityContext(
  request,
  response,
  {
    securityService,
    user,
    log = securityLog,
  },
) {
  if (
    typeof request
      .recordAdminSecurityIncident ===
    'function'
  ) {
    return;
  }

  let outcomeRecorded =
    false;

  request.recordAdminSecurityIncident =
    (
      event,
      details = {},
    ) => {
      if (
        event ===
          'admin.request.rejected' &&
        outcomeRecorded
      ) {
        return;
      }

      if (
        event !==
        'admin.request.rejected'
      ) {
        request
          .adminSecurityIncidentRecorded =
          true;
      }

      const ipAddress =
        requestClientIp(
          request,
        );
      const safeDetails = {
        method:
          request.method,
        path:
          requestPath(
            request,
          ),
        ...details,
      };

      log(
        event,
        {
          ...safeDetails,
          ip:
            ipAddress,
          userId:
            user?.id ??
            null,
          username:
            user?.username ??
            null,
        },
      );

      if (
        typeof securityService
          ?.appendAudit ===
        'function'
      ) {
        void Promise.resolve(
          securityService
            .appendAudit({
              eventType:
                'security',
              operationType:
                event,
              status:
                auditStatus(
                  event,
                ),
              durationMs:
                null,
              ipAddress,
              userId:
                user?.id ??
                null,
              username:
                user?.username ??
                null,
              details:
                safeDetails,
            }),
        ).catch(
          (error) =>
            console.error(
              'Admin request security audit write failed',
              error,
            ),
        );
      }

      if (
        event ===
        'admin.request.rejected'
      ) {
        outcomeRecorded =
          true;
      }
    };

  if (
    typeof response?.once !==
    'function'
  ) {
    return;
  }

  const recordOutcome =
    () => {
      if (
        outcomeRecorded ||
        request
          .adminSecurityIncidentRecorded ||
        response.statusCode < 400
      ) {
        return;
      }

      request
        .recordAdminSecurityIncident(
          'admin.request.rejected',
          {
            statusCode:
              response.statusCode,
          },
        );
    };

  response.once(
    'finish',
    recordOutcome,
  );
  response.once(
    'close',
    recordOutcome,
  );
}

export function rejectAdminTransportTampering(
  request,
  response,
) {
  const findings =
    detectAdminTransportTampering(
      request,
    );

  if (
    findings.length === 0
  ) {
    return false;
  }

  request
    .recordAdminSecurityIncident?.(
      'admin.request.tamper',
      {
        statusCode: 400,
        fields:
          findings,
      },
    );

  response
    .status(400)
    .json({
      error:
        'Request must not assert server-owned authentication or authorization attributes',
    });

  return true;
}

export function adminJsonBodySecurityGuard(
  request,
  response,
  next,
) {
  const findings =
    detectAdminBodyTampering(
      request,
    );

  if (
    findings.length === 0
  ) {
    next();
    return;
  }

  if (
    typeof request
      .recordAdminSecurityIncident ===
    'function'
  ) {
    request
      .recordAdminSecurityIncident(
        'admin.request.tamper',
        {
          statusCode: 400,
          fields:
            findings,
        },
      );
  } else {
    securityLog(
      'admin.request.tamper',
      {
        method:
          request.method,
        path:
          requestPath(
            request,
          ),
        ip:
          requestClientIp(
            request,
          ),
        userId: null,
        username: null,
        statusCode: 400,
        fields:
          findings,
      },
    );
  }

  response
    .status(400)
    .json({
      error:
        'Request must not assert server-owned authentication or authorization attributes',
    });
}
