export const PROMETHEUS_CONTENT_TYPE =
  'text/plain; version=0.0.4; charset=utf-8';

function requestBearerToken(
  request,
) {
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
    return null;
  }

  const token =
    authorization.slice(
      prefix.length,
    );

  return token ||
    null;
}

export function installMetricsEndpoint(
  app,
  {
    metrics,
    securityService,
  },
) {
  app.get(
    '/metrics',
    async (
      request,
      response,
      next,
    ) => {
      response.set(
        'Cache-Control',
        'no-store',
      );

      try {
        const access =
          await securityService
            .authorizeMetricsToken(
              requestBearerToken(
                request,
              ),
            );

        if (!access.enabled) {
          response
            .status(
              404,
            )
            .type(
              'text',
            )
            .send(
              'Not found\n',
            );
          return;
        }

        if (
          !access.authorized
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
      } catch (error) {
        next(error);
      }
    },
  );
}
