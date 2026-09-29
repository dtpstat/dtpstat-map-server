import {
  securityLog,
} from '../service-log.js';
import {
  requestClientIp,
} from '../shared/http/client-ip.js';

const DANGEROUS_KEYS =
  new Set([
    '__proto__',
    'prototype',
    'constructor',
  ]);

const SAFE_PARAMETER_NAME =
  /^[A-Za-z][A-Za-z0-9]*$/u;

const SAFE_BODY_PARAMETER_NAME =
  /^_?[A-Za-z][A-Za-z0-9_]*$/u;

const COMMON_ADMIN_HEADERS =
  new Set([
    'x-dtpstat-api-version',
  ]);

const COMMON_MUTATION_HEADERS =
  new Set([
    'x-dtpstat-api-version',
    'x-dtpstat-realtime-client',
  ]);

const FORBIDDEN_METHOD_OVERRIDE_HEADERS =
  new Set([
    'x-http-method-override',
    'x-method-override',
  ]);

function c(
  method,
  path,
  options = {},
) {
  return Object.freeze({
    method,
    path,
    query:
      Object.freeze(
        options.query ??
        [],
      ),
    body:
      options.body ??
      'none',
    bodyKeys:
      options.bodyKeys
        ? Object.freeze(
            options.bodyKeys,
          )
        : null,
    headers:
      Object.freeze(
        options.headers ??
        (
          path.startsWith(
            '/admin/',
          )
            ? (
                [
                  'POST',
                  'PUT',
                  'PATCH',
                  'DELETE',
                ].includes(
                  method,
                )
                  ? [
                      ...COMMON_MUTATION_HEADERS,
                    ]
                  : [
                      ...COMMON_ADMIN_HEADERS,
                    ]
              )
            : []
        ),
      ),
  });
}

const SECURITY_SETTINGS_KEYS = [
  'maxFailedAttempts',
  'failureWindowSeconds',
  'lockoutSeconds',
  'ipMaxFailedAttempts',
  'ipFailureWindowSeconds',
  'ipLockoutSeconds',
  'sessionIdleSeconds',
  'sessionAbsoluteSeconds',
  'auditRetentionDays',
  'requestRateLimitUserPerMinute',
  'requestRateLimitGlobalPerMinute',
  'passwordMinLength',
  'passwordMaxLength',
  'passwordRequireLowercase',
  'passwordRequireUppercase',
  'passwordRequireDigit',
  'passwordRequireSpecial',
];

const USER_CAPABILITY_KEYS = [
  'canManageData',
  'canManageInterface',
  'canEditOsm',
  'canEditGeometries',
  'canManageUsers',
  'canViewAudit',
  'canManageSecurity',
];

const GEOMETRY_VALUE_KEYS = [
  'cityId',
  'geometry',
  'displayName',
  'tooltip',
  'tags',
  'isVisible',
  'lineTypeId',
  'pointTypeId',
  'lanes',
];

const OSM_BOUNDARY_CHANGE_KEYS = [
  'active',
  'displayName',
  'displayType',
  'population',
  'populationAsOf',
  'populationSource',
  'attributes',
];

const OSM_SETTINGS_KEYS = [
  'sourceURL',
  'includeCity',
  'includeTown',
  'includeAdministrative',
  'adminLevelMin',
  'adminLevelMax',
  'batchSize',
  'minDelayMs',
  'timeoutMs',
  'queryTimeoutSeconds',
  'maxResponseBytes',
  'maxTotalBytes',
  'maxRetries',
  'retryBaseDelayMs',
  'retryMaxDelayMs',
];

const OSM_UPDATE_KEYS = [
  'URL',
  'dryRun',
  'resume',
  'restart',
  'includeCity',
  'includeTown',
  'includeAdministrative',
  'adminLevelMin',
  'adminLevelMax',
  'timeoutMs',
  'queryTimeoutSeconds',
  'maxResponseBytes',
  'maxTotalBytes',
  'batchSize',
  'minDelayMs',
  'maxRetries',
  'retryBaseDelayMs',
  'retryMaxDelayMs',
];

const KML_UPDATE_KEYS = [
  'sources',
  'dryRun',
  'timeoutMs',
  'maxFileBytes',
  'maxTotalBytes',
  'cityBufferMeters',
  'unmatchedPolicy',
  'ambiguousPolicy',
];

export const API_REQUEST_CONTRACTS =
  Object.freeze([
    c('GET', '/config'),
    c('GET', '/health'),
    c('GET', '/cities'),
    c(
      'GET',
      '/cities/:cityId/geometries',
    ),
    c(
      'GET',
      '/geometries',
      {
        query: [
          'bbox',
          'center',
        ],
      },
    ),
    c('GET', '/line-types'),
    c('GET', '/point-types'),
    c('GET', '/report-config'),
    c('GET', '/project'),
    c('GET', '/city-marker-icon'),

    c(
      'PUT',
      '/admin/line-types',
      {
        body: 'json-object',
        bodyKeys: [
          'lineTypes',
        ],
      },
    ),
    c(
      'POST',
      '/admin/point-types',
      {
        body: 'json-object',
        bodyKeys: [
          'name',
          'isActive',
          'displayWidth',
          'displayHeight',
          'anchorX',
          'anchorY',
        ],
      },
    ),
    c(
      'PATCH',
      '/admin/point-types/:pointTypeId',
      {
        body: 'json-object',
        bodyKeys: [
          'name',
          'isActive',
          'displayWidth',
          'displayHeight',
          'anchorX',
          'anchorY',
        ],
      },
    ),
    c(
      'DELETE',
      '/admin/point-types/:pointTypeId',
    ),
    c(
      'POST',
      '/admin/update',
      {
        body:
          'json-object-optional',
        bodyKeys:
          KML_UPDATE_KEYS,
      },
    ),
    c(
      'GET',
      '/admin/osm-checkpoint',
    ),
    c(
      'DELETE',
      '/admin/osm-checkpoint',
    ),
    c(
      'POST',
      '/admin/update/cities',
      {
        body:
          'json-object-optional',
        bodyKeys:
          OSM_UPDATE_KEYS,
      },
    ),
    c(
      'POST',
      '/admin/import',
      {
        body: 'stream',
      },
    ),
    c(
      'POST',
      '/admin/import/lines',
      {
        body: 'stream',
      },
    ),
    c(
      'POST',
      '/admin/import/cities',
      {
        body: 'stream',
        headers: [
          ...COMMON_MUTATION_HEADERS,
          'x-dtpstat-dry-run',
        ],
      },
    ),
    c(
      'POST',
      '/admin/populations',
      {
        body: 'stream',
      },
    ),
    c(
      'GET',
      '/admin/export/cities',
    ),
    c(
      'GET',
      '/admin/export/cities.zip',
    ),
    c(
      'GET',
      '/admin/export/lines',
    ),
    c(
      'GET',
      '/admin/export/lines.zip',
    ),
    c(
      'GET',
      '/admin/export/populations',
    ),
    c(
      'GET',
      '/admin/export/populations.zip',
    ),
    c(
      'GET',
      '/admin/export/lines.kml',
    ),
    c(
      'POST',
      '/admin/import/lines.kml',
      {
        body: 'text',
      },
    ),
    c(
      'GET',
      '/admin/config',
    ),
    c(
      'GET',
      '/admin/status',
    ),
    c(
      'GET',
      '/admin/status/:taskId',
    ),
    c(
      'POST',
      '/admin/cancel',
    ),
    c(
      'POST',
      '/admin/cancel/:taskId',
    ),

    c(
      'GET',
      '/admin/settings/export',
    ),
    c(
      'POST',
      '/admin/settings/import',
      {
        body: 'json-object',
        bodyKeys: [
          '_dtpstat',
          'projectSettings',
          'lineTypes',
          'reportConfig',
          'securitySettings',
        ],
      },
    ),

    c(
      'GET',
      '/admin/project-settings',
    ),
    c(
      'PUT',
      '/admin/project-settings',
      {
        body: 'json-object',
        bodyKeys: [
          'projectName',
          'keywords',
          'footerHtml',
          'yandexMetrikaId',
          'googleAnalyticsId',
          'themePreset',
          'showLineLabels',
          'showLinePopups',
          'mapboxAccessToken',
          'largeCityPopulationThreshold',
          'largeCityAreaKm2Threshold',
        ],
      },
    ),
    c(
      'PUT',
      '/admin/project-settings/public-download-name',
      {
        body: 'json-object',
        bodyKeys: [
          'publicDownloadName',
        ],
      },
    ),
    c(
      'PUT',
      '/admin/project-settings/city-marker-icon',
      {
        body: 'binary',
      },
    ),
    c(
      'DELETE',
      '/admin/project-settings/city-marker-icon',
    ),
    c(
      'GET',
      '/admin/report-config',
    ),
    c(
      'PUT',
      '/admin/report-config',
      {
        body: 'json-object',
        bodyKeys: [
          'metrics',
          'tableColumns',
          'csvColumns',
          'rank',
        ],
      },
    ),

    c(
      'GET',
      '/admin/osm-settings',
    ),
    c(
      'PUT',
      '/admin/osm-settings',
      {
        body: 'json-object',
        bodyKeys:
          OSM_SETTINGS_KEYS,
      },
    ),
    c(
      'GET',
      '/admin/osm-boundaries',
    ),
    c(
      'GET',
      '/admin/osm-boundaries/:boundaryId/geometry',
    ),
    c(
      'PATCH',
      '/admin/osm-boundaries/:boundaryId/subtree',
      {
        body: 'json-object',
        bodyKeys: [
          'active',
        ],
      },
    ),
    c(
      'PATCH',
      '/admin/osm-boundaries',
      {
        body: 'json-object',
        bodyKeys: [
          'updates',
        ],
      },
    ),
    c(
      'PATCH',
      '/admin/osm-boundaries/:boundaryId',
      {
        body: 'json-object',
        bodyKeys:
          OSM_BOUNDARY_CHANGE_KEYS,
        headers: [
          ...COMMON_MUTATION_HEADERS,
          'x-dtpstat-base-revision',
        ],
      },
    ),

    c(
      'GET',
      '/admin/geometry-import/tasks/:taskId',
    ),
    c(
      'GET',
      '/admin/geometry-import/pending',
    ),
    c(
      'DELETE',
      '/admin/geometry-import/:sessionId',
    ),
    c(
      'POST',
      '/admin/geometry-import/:sessionId/apply',
      {
        body: 'json-object',
        bodyKeys: [
          'decisions',
        ],
      },
    ),

    c(
      'GET',
      '/admin/geometry-editor/cities',
    ),
    c(
      'GET',
      '/admin/geometry-editor/cities/:cityId/geometries',
    ),
    c(
      'GET',
      '/admin/geometry-editor/unlinked/geometries',
    ),
    c(
      'GET',
      '/admin/geometry-editor/edit-locks',
    ),
    c(
      'GET',
      '/admin/geometry-editor/geometries/:geometryId',
    ),
    c(
      'POST',
      '/admin/geometry-editor/geometries/:geometryId/edit-lock',
    ),
    c(
      'POST',
      '/admin/geometry-editor/geometries/:geometryId/edit-lock/heartbeat',
      {
        headers: [
          ...COMMON_MUTATION_HEADERS,
          'x-dtpstat-edit-token',
        ],
      },
    ),
    c(
      'POST',
      '/admin/geometry-editor/edit-locks/validate',
      {
        body: 'json-object',
        bodyKeys: [
          'items',
        ],
      },
    ),
    c(
      'POST',
      '/admin/geometry-editor/geometries/:geometryId/edit-lock/release',
      {
        headers: [
          ...COMMON_MUTATION_HEADERS,
          'x-dtpstat-edit-token',
        ],
      },
    ),
    c(
      'POST',
      '/admin/geometry-editor/geometries/:geometryId/edit-lock/takeover',
    ),
    c(
      'POST',
      '/admin/geometry-editor/sync',
      {
        body: 'json-object',
        bodyKeys: [
          'items',
        ],
      },
    ),
    c(
      'POST',
      '/admin/geometry-editor/geometries',
      {
        body: 'json-object',
        bodyKeys:
          GEOMETRY_VALUE_KEYS,
      },
    ),
    c(
      'PATCH',
      '/admin/geometry-editor/geometries',
      {
        body: 'json-object',
        bodyKeys: [
          'updates',
        ],
      },
    ),
    c(
      'PATCH',
      '/admin/geometry-editor/geometries/:geometryId',
      {
        body: 'json-object',
        bodyKeys: [
          'geometry',
          'displayName',
          'tooltip',
          'tags',
          'isVisible',
          'lineTypeId',
          'pointTypeId',
          'lanes',
        ],
        headers: [
          ...COMMON_MUTATION_HEADERS,
          'x-dtpstat-base-revision',
        ],
      },
    ),
    c(
      'DELETE',
      '/admin/geometry-editor/geometries/:geometryId',
      {
        headers: [
          ...COMMON_MUTATION_HEADERS,
          'x-dtpstat-base-revision',
          'x-dtpstat-edit-token',
        ],
      },
    ),
    c(
      'POST',
      '/admin/geometry-editor/merge',
      {
        body: 'json-object',
        bodyKeys: [
          'items',
        ],
      },
    ),
    c(
      'POST',
      '/admin/geometry-editor/geometries/:geometryId/cut',
      {
        body: 'json-object',
        bodyKeys: [
          'geometry',
          'cutterGeometryId',
          'cutterUpdatedAt',
        ],
        headers: [
          ...COMMON_MUTATION_HEADERS,
          'x-dtpstat-base-revision',
          'x-dtpstat-edit-token',
        ],
      },
    ),
    c(
      'POST',
      '/admin/geometry-editor/geometries/:geometryId/split',
      {
        body: 'json-object',
        bodyKeys: [
          'blade',
        ],
        headers: [
          ...COMMON_MUTATION_HEADERS,
          'x-dtpstat-base-revision',
          'x-dtpstat-edit-token',
        ],
      },
    ),
    c(
      'POST',
      '/admin/geometry-editor/recalculate',
    ),

    c(
      'POST',
      '/admin/login',
      {
        body: 'json-object',
        bodyKeys: [
          'username',
          'password',
        ],
      },
    ),
    c(
      'POST',
      '/admin/logout',
    ),
    c(
      'GET',
      '/admin/me',
    ),
    c(
      'PATCH',
      '/admin/profile',
      {
        body: 'json-object',
        bodyKeys: [
          'displayName',
          'email',
        ],
      },
    ),
    c(
      'GET',
      '/admin/profile/password-policy',
    ),
    c(
      'PUT',
      '/admin/profile/password',
      {
        body: 'json-object',
        bodyKeys: [
          'currentPassword',
          'newPassword',
        ],
      },
    ),
    c(
      'GET',
      '/admin/profile/avatar',
    ),
    c(
      'PUT',
      '/admin/profile/avatar',
      {
        body: 'binary',
      },
    ),
    c(
      'DELETE',
      '/admin/profile/avatar',
    ),
    c(
      'GET',
      '/admin/profile/sessions',
    ),
    c(
      'DELETE',
      '/admin/profile/sessions/others',
    ),
    c(
      'DELETE',
      '/admin/profile/sessions/:sessionId',
    ),

    c(
      'GET',
      '/admin/security/settings',
    ),
    c(
      'PUT',
      '/admin/security/settings',
      {
        body: 'json-object',
        bodyKeys:
          SECURITY_SETTINGS_KEYS,
      },
    ),
    c(
      'GET',
      '/admin/security/ip-blocks',
    ),
    c(
      'POST',
      '/admin/security/ip-blocks',
      {
        body: 'json-object',
        bodyKeys: [
          'ipAddress',
          'durationSeconds',
          'reason',
          'sourceAuditId',
        ],
      },
    ),
    c(
      'DELETE',
      '/admin/security/ip-blocks/:blockId',
    ),
    c(
      'GET',
      '/admin/security/users',
    ),
    c(
      'POST',
      '/admin/security/users',
      {
        body: 'json-object',
        bodyKeys: [
          'username',
          'displayName',
          'email',
          'password',
          ...USER_CAPABILITY_KEYS,
        ],
      },
    ),
    c(
      'PATCH',
      '/admin/security/users/:userId',
      {
        body: 'json-object',
        bodyKeys: [
          'displayName',
          'email',
          ...USER_CAPABILITY_KEYS,
        ],
      },
    ),
    c(
      'DELETE',
      '/admin/security/users/:userId',
    ),
    c(
      'POST',
      '/admin/security/users/:userId/temporary-password',
    ),
    c(
      'POST',
      '/admin/security/users/:userId/block',
      {
        body: 'json-object',
        bodyKeys: [
          'durationSeconds',
          'reason',
        ],
      },
    ),
    c(
      'POST',
      '/admin/security/users/:userId/unblock',
    ),
    c(
      'GET',
      '/admin/security/users/:userId/avatar',
    ),
    c(
      'GET',
      '/admin/security/audit/facets',
    ),
    c(
      'GET',
      '/admin/security/audit',
      {
        query: [
          'limit',
          'offset',
          'eventType',
          'operationType',
          'status',
          'username',
          'ipAddress',
          'from',
          'to',
        ],
      },
    ),
    c(
      'GET',
      '/admin/security/audit/export.csv',
      {
        query: [
          'limit',
          'offset',
          'eventType',
          'operationType',
          'status',
          'username',
          'ipAddress',
          'from',
          'to',
        ],
      },
    ),
  ]);

function compilePath(
  path,
) {
  const pattern =
    path
      .split('/')
      .map(
        (part) =>
          part.startsWith(':')
            ? '[^/]+'
            : part.replace(
                /[.*+?^$()|[\]{}]/gu,
                '\\$&',
              ),
      )
      .join('/');

  return new RegExp(
    '^' + pattern + '$',
    'u',
  );
}

const COMPILED_CONTRACTS =
  API_REQUEST_CONTRACTS.map(
    (contract) => ({
      ...contract,
      matcher:
        compilePath(
          contract.path,
        ),
    }),
  );

function apiPath(request) {
  const path =
    String(
      request.originalUrl ??
      request.url ??
      request.path ??
      '',
    ).split('?')[0];

  return path.startsWith('/api')
    ? (
        path.slice(4) ||
        '/'
      )
    : path;
}

function rawSearchParams(request) {
  const original =
    String(
      request.originalUrl ??
      request.url ??
      '',
    );
  const queryIndex =
    original.indexOf('?');

  return queryIndex < 0
    ? new URLSearchParams()
    : new URLSearchParams(
        original.slice(
          queryIndex + 1,
        ),
      );
}

function hasRequestBody(request) {
  return (
    request.headers?.[
      'transfer-encoding'
    ] !== undefined ||
    Number(
      request.headers?.[
        'content-length'
      ] ??
      0,
    ) > 0
  );
}

function requestContentType(
  request,
) {
  return String(
    request.headers?.[
      'content-type'
    ] ??
    '',
  )
    .split(';')[0]
    .trim()
    .toLocaleLowerCase(
      'en-US',
    );
}

function expectsJsonBody(
  contract,
) {
  return [
    'json-object',
    'json-object-optional',
    'json-array',
  ].includes(
    contract.body,
  );
}

function safeParameterName(
  key,
  body = false,
) {
  if (
    DANGEROUS_KEYS.has(
      String(key)
        .toLocaleLowerCase(
          'en-US',
        ),
    )
  ) {
    return false;
  }

  return (
    body
      ? SAFE_BODY_PARAMETER_NAME
      : SAFE_PARAMETER_NAME
  ).test(key);
}

function contractFor(
  method,
  path,
) {
  return (
    COMPILED_CONTRACTS.find(
      (contract) =>
        contract.method ===
          method &&
        contract.matcher
          .test(path),
    ) ??
    null
  );
}

function contractsForPath(path) {
  return COMPILED_CONTRACTS
    .filter(
      (contract) =>
        contract.matcher
          .test(path),
    );
}

function logSafeText(
  value,
  maximum = 160,
) {
  let result = '';

  for (
    const character of
    String(value ?? '')
  ) {
    const code =
      character.codePointAt(0);

    if (
      code >= 0x20 &&
      code <= 0x7e
    ) {
      result += character;
    } else {
      result +=
        '\\u{' +
        code
          .toString(16)
          .toUpperCase() +
        '}';
    }

    if (
      result.length >=
      maximum
    ) {
      return (
        result.slice(
          0,
          maximum,
        ) +
        '…'
      );
    }
  }

  return result;
}

function safeIncident(
  incident,
) {
  return {
    reason:
      logSafeText(
        incident.reason,
        96,
      ),
    method:
      logSafeText(
        incident.method,
        16,
      ),
    path:
      logSafeText(
        incident.path,
        512,
      ),
    fields:
      Array.isArray(
        incident.fields,
      )
        ? incident.fields
            .slice(0, 32)
            .map(
              (field) =>
                logSafeText(
                  field,
                  120,
                ),
            )
        : [],
    userId:
      incident.userId ??
      null,
    username:
      incident.username
        ? logSafeText(
            incident.username,
            96,
          )
        : null,
  };
}

async function recordContractIncident(
  request,
  incident,
) {
  const safe =
    safeIncident(
      incident,
    );

  if (
    typeof request
      .recordApiContractIncident ===
    'function'
  ) {
    return request
      .recordApiContractIncident(
        safe,
      );
  }

  securityLog(
    'api.request.contract_violation',
    {
      ...safe,
      ip:
        requestClientIp(
          request,
        ),
    },
  );

  return null;
}

async function reject(
  request,
  response,
  reason,
  details = {},
  statusCode = 400,
) {
  const incident = {
    reason,
    method:
      request.method,
    path:
      apiPath(request),
    fields:
      details.fields ??
      [],
    userId:
      request.adminUser?.id ??
      null,
    username:
      request.adminUser
        ?.username ??
      null,
  };

  const securityState =
    await recordContractIncident(
      request,
      incident,
    );

  if (
    securityState?.locked
  ) {
    response.set(
      'Retry-After',
      String(
        securityState
          .retryAfterSeconds ??
        1,
      ),
    );
    response
      .status(429)
      .json({
        error:
          'This IP address is temporarily locked after repeated invalid API requests',
        code:
          'api_request_ip_locked',
        retryAfterSeconds:
          securityState
            .retryAfterSeconds ??
          1,
      });
    return;
  }

  response
    .status(statusCode)
    .json({
      error:
        'Request does not match the API contract',
      code:
        'api_contract_violation',
      reason,
    });
}

function validateDtpstatHeaders(
  request,
  contract,
) {
  const allowed =
    new Set(
      contract.headers,
    );

  return Object.keys(
    request.headers ??
    {},
  ).filter(
    (name) =>
      name
        .toLocaleLowerCase(
          'en-US',
        )
        .startsWith(
          'x-dtpstat-',
        ) &&
      !allowed.has(
        name.toLocaleLowerCase(
          'en-US',
        ),
      ),
  );
}

function unsafeRequestPath(
  request,
) {
  const path =
    String(
      request.originalUrl ??
      request.url ??
      request.path ??
      '',
    ).split('?')[0];

  if (
    /%(?:2f|5c|00|0a|0d)/iu
      .test(path)
  ) {
    return true;
  }

  let decoded;
  try {
    decoded =
      decodeURIComponent(path);
  } catch {
    return true;
  }

  if (
    /[\\\u0000-\u001f\u007f]/u
      .test(decoded)
  ) {
    return true;
  }

  return decoded
    .split('/')
    .some(
      (segment) =>
        segment === '.' ||
        segment === '..',
    );
}

function forbiddenMethodOverrideHeaders(
  request,
) {
  return Object.keys(
    request.headers ??
    {},
  ).filter(
    (name) =>
      FORBIDDEN_METHOD_OVERRIDE_HEADERS
        .has(
          name.toLocaleLowerCase(
            'en-US',
          ),
        ),
  );
}

export async function enforceApiRequestContract(
  request,
  response,
  next,
) {
  const method =
    String(
      request.method ??
      '',
    ).toUpperCase();

  if (
    unsafeRequestPath(
      request,
    )
  ) {
    await reject(
      request,
      response,
      'unsafe-request-path',
    );
    return;
  }

  const overrideHeaders =
    forbiddenMethodOverrideHeaders(
      request,
    );
  if (
    overrideHeaders.length > 0
  ) {
    await reject(
      request,
      response,
      'method-override-not-allowed',
      {
        fields:
          overrideHeaders,
      },
    );
    return;
  }

  const path =
    apiPath(request);
  const pathContracts =
    contractsForPath(
      path,
    );

  if (
    pathContracts.length === 0
  ) {
    await reject(
      request,
      response,
      'unknown-api-endpoint',
      {},
      404,
    );
    return;
  }

  const contract =
    contractFor(
      method,
      path,
    );

  if (!contract) {
    await reject(
      request,
      response,
      'method-not-allowed',
      {
        allowedMethods:
          pathContracts.map(
            (item) =>
              item.method,
          ),
      },
      405,
    );
    return;
  }

  const unsupportedHeaders =
    validateDtpstatHeaders(
      request,
      contract,
    );
  if (
    unsupportedHeaders.length >
    0
  ) {
    await reject(
      request,
      response,
      'unsupported-dtpstat-header',
      {
        fields:
          unsupportedHeaders,
      },
    );
    return;
  }

  const params =
    rawSearchParams(
      request,
    );
  const queryKeys =
    [...params.keys()];
  const uniqueKeys =
    new Set();

  for (const key of queryKeys) {
    if (
      !safeParameterName(
        key,
      )
    ) {
      await reject(
        request,
        response,
        'unsafe-query-parameter-name',
        {
          fields: [
            key,
          ],
        },
      );
      return;
    }

    if (uniqueKeys.has(key)) {
      await reject(
        request,
        response,
        'duplicate-query-parameter',
        {
          fields: [
            key,
          ],
        },
      );
      return;
    }

    uniqueKeys.add(key);
  }

  if (
    ![
      'GET',
      'HEAD',
    ].includes(method) &&
    queryKeys.length > 0
  ) {
    await reject(
      request,
      response,
      'query-not-allowed-for-mutating-request',
      {
        fields:
          [...uniqueKeys],
      },
    );
    return;
  }

  const allowedQuery =
    new Set(
      contract.query,
    );
  const unsupportedQuery =
    [...uniqueKeys]
      .filter(
        (key) =>
          !allowedQuery.has(
            key,
          ),
      );

  if (
    unsupportedQuery.length >
    0
  ) {
    await reject(
      request,
      response,
      'unsupported-query-parameter',
      {
        fields:
          unsupportedQuery,
      },
    );
    return;
  }

  if (
    [
      'GET',
      'HEAD',
    ].includes(method) &&
    hasRequestBody(
      request,
    )
  ) {
    await reject(
      request,
      response,
      'body-not-allowed-for-read-request',
    );
    return;
  }

  if (
    expectsJsonBody(
      contract,
    ) &&
    hasRequestBody(
      request,
    ) &&
    requestContentType(
      request,
    ) !==
      'application/json'
  ) {
    await reject(
      request,
      response,
      'unsupported-content-type',
      {},
      415,
    );
    return;
  }

  if (
    contract.body ===
      'none' &&
    hasRequestBody(
      request,
    )
  ) {
    await reject(
      request,
      response,
      'body-not-allowed',
    );
    return;
  }

  request.apiContract =
    contract;
  next();
}

export function validateParsedApiBody(
  request,
) {
  const contract =
    request.apiContract ??
    contractFor(
      String(
        request.method ??
        '',
      ).toUpperCase(),
      apiPath(request),
    );

  if (!contract) {
    return {
      valid: false,
      reason:
        'missing-api-contract',
      fields: [],
    };
  }

  const body =
    request.body;
  const kind =
    contract.body;

  if (
    kind === 'none' ||
    kind === 'stream' ||
    kind === 'binary' ||
    kind === 'text'
  ) {
    return {
      valid: true,
      fields: [],
    };
  }

  if (
    expectsJsonBody(
      contract,
    ) &&
    body === undefined &&
    hasRequestBody(
      request,
    ) &&
    requestContentType(
      request,
    ) !==
      'application/json'
  ) {
    return {
      valid: false,
      reason:
        'unsupported-content-type',
      fields: [],
      statusCode: 415,
    };
  }

  if (
    kind ===
      'json-array'
  ) {
    return Array.isArray(body)
      ? {
          valid: true,
          fields: [],
        }
      : {
          valid: false,
          reason:
            'body-must-be-json-array',
          fields: [],
        };
  }

  if (
    kind ===
      'json-object-optional' &&
    body === undefined
  ) {
    return {
      valid: true,
      fields: [],
    };
  }

  if (
    !body ||
    typeof body !==
      'object' ||
    Array.isArray(body) ||
    Buffer.isBuffer(body)
  ) {
    return {
      valid: false,
      reason:
        'body-must-be-json-object',
      fields: [],
    };
  }

  const keys =
    Object.keys(body);

  const unsafe =
    keys.filter(
      (key) =>
        !safeParameterName(
          key,
          true,
        ),
    );

  if (unsafe.length > 0) {
    return {
      valid: false,
      reason:
        'unsafe-body-parameter-name',
      fields:
        unsafe,
    };
  }

  const allowed =
    new Set(
      contract.bodyKeys ??
      [],
    );
  const unsupported =
    keys.filter(
      (key) =>
        !allowed.has(key),
    );

  if (
    unsupported.length > 0
  ) {
    return {
      valid: false,
      reason:
        'unsupported-body-parameter',
      fields:
        unsupported,
    };
  }

  return {
    valid: true,
    fields: [],
  };
}

export function createApiRequestContractMiddleware({
  securityService,
} = {}) {
  return async (
    request,
    response,
    next,
  ) => {
    request.recordApiContractIncident =
      async (incident) => {
        const details = {
          ...incident,
          userId:
            request.adminUser?.id ??
            incident.userId ??
            null,
          username:
            request.adminUser
              ?.username ??
            incident.username ??
            null,
        };

        if (
          typeof securityService
            ?.recordRequestSecurityIncident ===
          'function'
        ) {
          return securityService
            .recordRequestSecurityIncident(
              requestClientIp(
                request,
              ),
              details,
            );
        }

        securityLog(
          'api.request.contract_violation',
          {
            ...details,
            ip:
              requestClientIp(
                request,
              ),
          },
        );

        return null;
      };

    await enforceApiRequestContract(
      request,
      response,
      next,
    );
  };
}


export function apiContractKey(
  method,
  path,
) {
  return (
    String(method)
      .toUpperCase() +
    ' ' +
    path
  );
}
