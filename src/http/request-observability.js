import crypto from 'node:crypto';
import {
  serviceLog,
} from '../service-log.js';
import {
  apiMetricRoute,
} from './api-request-contract.js';

export const REQUEST_ID_HEADER =
  'X-Request-ID';

const REQUEST_ID_PATTERN =
  /^[A-Za-z0-9._:-]{1,128}$/u;

export function normalizeRequestId(
  value,
) {
  if (
    typeof value !==
    'string'
  ) {
    return null;
  }

  const normalized =
    value.trim();

  return REQUEST_ID_PATTERN
    .test(
      normalized,
    )
    ? normalized
    : null;
}

function requestPath(
  request,
) {
  return String(
    request.originalUrl ??
    request.path ??
    request.url ??
    '',
  ).split('?')[0];
}

function requestRoute(
  request,
) {
  const routePath =
    request.route
      ?.path;

  if (
    typeof routePath !==
    'string'
  ) {
    return requestPath(
      request,
    );
  }

  return `${request.baseUrl ?? ''}${routePath}`;
}

function durationMs(
  startedAt,
  now,
) {
  return Number(
    Math.max(
      0,
      now() -
        startedAt,
    ).toFixed(
      3,
    ),
  );
}

/**
 * Add correlation and duration logging to API requests only.
 * Query strings, request bodies, cookies and authorization data are never
 * included in the service log.
 *
 * @param {{
 *   log?: typeof serviceLog,
 *   now?: () => number,
 *   createRequestId?: () => string,
 *   metrics?: { observeHttpRequest: (details: object) => void }
 * }} [options]
 */
export function createApiRequestObservability(
  options = {},
) {
  const log =
    options.log ??
    serviceLog;
  const now =
    options.now ??
    (() =>
      performance.now());
  const createRequestId =
    options.createRequestId ??
    crypto.randomUUID;
  const metrics =
    options.metrics ??
    null;

  return (
    request,
    response,
    next,
  ) => {
    if (
      !request.path
        .startsWith(
          '/api',
        )
    ) {
      next();
      return;
    }

    const suppliedRequestId =
      normalizeRequestId(
        request.get(
          REQUEST_ID_HEADER,
        ),
      );
    const requestId =
      suppliedRequestId ??
      createRequestId();

    request.requestId =
      requestId;
    response.set(
      REQUEST_ID_HEADER,
      requestId,
    );

    const startedAt =
      now();
    let completed =
      false;

    const complete = (
      aborted,
    ) => {
      if (completed) {
        return;
      }
      completed =
        true;

      const statusCode =
        Number(
          response.statusCode ??
          0,
        );
      const details = {
        requestId,
        method:
          request.method,
        path:
          requestRoute(
            request,
          ),
        statusCode,
        durationMs:
          durationMs(
            startedAt,
            now,
          ),
        ...(aborted
          ? {
              aborted:
                true,
            }
          : {}),
      };

      metrics
        ?.observeHttpRequest({
          method:
            request.method,
          route:
            apiMetricRoute(
              request,
            ),
          statusCode,
          durationMs:
            details.durationMs,
        });

      log(
        aborted ||
        statusCode >= 400
          ? (
              statusCode >= 500
                ? 'error'
                : 'warning'
            )
          : 'info',
        'http.request',
        details,
      );
    };

    response.once(
      'finish',
      () =>
        complete(
          false,
        ),
    );
    response.once(
      'close',
      () => {
        if (
          !response
            .writableEnded
        ) {
          complete(
            true,
          );
        }
      },
    );

    next();
  };
}
