import crypto from 'node:crypto';

export const PROMETHEUS_CONTENT_TYPE =
  'text/plain; version=0.0.4; charset=utf-8';

function tokenMatches(
  actual,
  expected,
) {
  if (
    typeof actual !==
      'string' ||
    typeof expected !==
      'string'
  ) {
    return false;
  }

  const actualBuffer =
    Buffer.from(
      actual,
      'utf8',
    );
  const expectedBuffer =
    Buffer.from(
      expected,
      'utf8',
    );

  return (
    actualBuffer.length ===
      expectedBuffer.length &&
    crypto.timingSafeEqual(
      actualBuffer,
      expectedBuffer,
    )
  );
}

export function metricsRequestAuthorized(
  request,
  bearerToken,
) {
  if (!bearerToken) {
    return true;
  }

  const authorization =
    request.get(
      'authorization',
    );
  const prefix =
    'Bearer ';

  if (
    typeof authorization !==
      'string' ||
    !authorization
      .startsWith(
        prefix,
      )
  ) {
    return false;
  }

  return tokenMatches(
    authorization.slice(
      prefix.length,
    ),
    bearerToken,
  );
}

export function installMetricsEndpoint(
  app,
  {
    config,
    metrics,
  },
) {
  if (
    !config.metrics
      ?.enabled
  ) {
    return;
  }

  app.get(
    '/metrics',
    (
      request,
      response,
    ) => {
      response.set(
        'Cache-Control',
        'no-store',
      );

      if (
        !metricsRequestAuthorized(
          request,
          config.metrics
            .bearerToken,
        )
      ) {
        response.set(
          'WWW-Authenticate',
          'Bearer realm="metrics"',
        );
        response
          .status(
            401,
          )
          .type(
            'text',
          )
          .send(
            'Unauthorized\n',
          );
        return;
      }

      response
        .status(
          200,
        )
        .set(
          'Content-Type',
          PROMETHEUS_CONTENT_TYPE,
        )
        .send(
          metrics.render(),
        );
    },
  );
}
