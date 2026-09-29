import {
  requestClientIp,
} from '../shared/http/client-ip.js';
import {
  securityLog,
  serviceLog,
} from '../service-log.js';

function requestPath(request) {
  return String(
    request.originalUrl ??
    request.path ??
    request.url ??
    '',
  ).split('?')[0];
}

function logRejectedRequest(
  request,
  statusCode,
  reason,
) {
  if (
    typeof request
      .recordAdminSecurityIncident ===
    'function'
  ) {
    request
      .recordAdminSecurityIncident(
        'admin.request.rejected',
        {
          statusCode,
          reason,
        },
      );
    return;
  }

  const details = {
    requestId:
      request.requestId ??
      null,
    method:
      request.method,
    path:
      requestPath(
        request,
      ),
    statusCode,
    reason,
    ip:
      requestClientIp(
        request,
      ),
  };

  if (
    requestPath(request)
      .startsWith(
        '/api/admin',
      )
  ) {
    securityLog(
      'admin.request.rejected',
      details,
    );
    return;
  }

  serviceLog(
    statusCode >= 500
      ? 'error'
      : 'warning',
    'http.request.rejected',
    details,
  );
}

export function installAppTerminalHandlers(
  app,
) {
  app.use(
    (
      request,
      response,
    ) => {
      if (
        request.path
          .startsWith('/api/')
      ) {
        logRejectedRequest(
          request,
          404,
          'api-endpoint-not-found',
        );
        response
          .status(404)
          .json({
            error:
              'API endpoint not found',
          });

        return;
      }

      response
        .status(404)
        .type('text')
        .send('Not found');
    },
  );

  app.use(
    async (
      error,
      request,
      response,
      _next,
    ) => {
      if (
        error?.type ===
        'entity.duplicate.json.key'
      ) {
        const fields =
          Array.isArray(
            error
              .duplicateJsonKeys,
          )
            ? error
                .duplicateJsonKeys
                .slice(0, 32)
            : [];
        const securityState =
          typeof request
            .recordApiContractIncident ===
          'function'
            ? await request
                .recordApiContractIncident({
                  reason:
                    'duplicate-json-key',
                  method:
                    request.method,
                  path:
                    requestPath(
                      request,
                    ),
                  fields,
                  userId:
                    request.adminUser?.id ??
                    null,
                  username:
                    request.adminUser
                      ?.username ??
                    null,
                })
            : null;

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

        logRejectedRequest(
          request,
          400,
          'duplicate-json-key',
        );
        response
          .status(400)
          .json({
            error:
              'Duplicate JSON object keys are not allowed',
            code:
              'api_contract_violation',
            reason:
              'duplicate-json-key',
          });
        return;
      }

      if (
        error?.type ===
        'entity.too.large'
      ) {
        logRejectedRequest(
          request,
          413,
          'request-body-too-large',
        );
        response
          .status(413)
          .json({
            error:
              'Request body is too large',
          });

        return;
      }

      if (
        error?.type ===
        'entity.parse.failed'
      ) {
        logRejectedRequest(
          request,
          400,
          'invalid-json',
        );
        response
          .status(400)
          .json({
            error:
              'Request body is not valid JSON',
          });

        return;
      }

      if (
        error?.status === 415 ||
        error?.type ===
          'encoding.unsupported'
      ) {
        logRejectedRequest(
          request,
          415,
          'unsupported-content-encoding',
        );
        response
          .status(415)
          .json({
            error:
              error.message ||
              'Unsupported content encoding',
          });

        return;
      }

      logRejectedRequest(
        request,
        503,
        'request-handler-failed',
      );

      response
        .status(503)
        .json({
          error:
            'Service temporarily unavailable',
        });
    },
  );
}
