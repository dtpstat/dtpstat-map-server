import {
  DTPSTAT_API_RELOAD_CODE,
  DTPSTAT_API_VERSION,
  DTPSTAT_API_VERSION_HEADER,
} from '../../public/js/api-contract.js';
import {
  serviceLog,
} from '../service-log.js';

const VERSION_EXEMPT_ADMIN_GET =
  Object.freeze([
    '/api/admin/export/',
    '/api/admin/settings/export',
  ]);

function requestPath(
  request,
) {
  return String(
    request.originalUrl ??
    request.url ??
    request.path ??
    '',
  ).split('?')[0];
}

function versionExempt(
  request,
) {
  if (
    String(
      request.method ??
      '',
    ).toUpperCase() !==
    'GET'
  ) {
    return false;
  }

  const path =
    requestPath(request);

  return VERSION_EXEMPT_ADMIN_GET
    .some(
      (prefix) =>
        path === prefix ||
        path.startsWith(
          prefix,
        ),
    );
}

export function requireAdminApiVersion(
  request,
  response,
  next,
) {
  if (
    versionExempt(
      request,
    )
  ) {
    next();
    return;
  }

  const supplied =
    request.get?.(
      DTPSTAT_API_VERSION_HEADER,
    ) ??
    request.headers?.[
      DTPSTAT_API_VERSION_HEADER
        .toLocaleLowerCase(
          'en-US',
        )
    ];

  if (
    supplied ===
    DTPSTAT_API_VERSION
  ) {
    next();
    return;
  }

  serviceLog(
    'warning',
    'admin.api.version_mismatch',
    {
      method:
        request.method,
      path:
        requestPath(
          request,
        ),
      suppliedVersion:
        supplied ?? null,
      requiredVersion:
        DTPSTAT_API_VERSION,
    },
  );

  response
    .set(
      'Cache-Control',
      'no-store',
    )
    .set(
      'X-DTPStat-API-Version-Required',
      DTPSTAT_API_VERSION,
    )
    .status(426)
    .json({
      error:
        'Administrative client is out of date; reload the page',
      code:
        DTPSTAT_API_RELOAD_CODE,
      requiredVersion:
        DTPSTAT_API_VERSION,
    });
}
