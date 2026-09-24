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
    (
      error,
      request,
      response,
      _next,
    ) => {
      if (
        error?.type ===
        'entity.too.large'
      ) {
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
        response
          .status(415)
          .json({
            error:
              error.message ||
              'Unsupported content encoding',
          });

        return;
      }

      console.error(
        'Request failed',
        {
          method:
            request.method,
          path:
            request.path,
          error:
            error instanceof Error
              ? error.message
              : String(error),
        },
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
