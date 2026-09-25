import {
  GeometryImportSessionError,
  normalizeGeometryImportSessionId,
} from './import-policy.js';

function sendValidationError(
  response,
  error,
) {
  if (
    !(error instanceof
      GeometryImportSessionError)
  ) {
    return false;
  }

  response
    .status(
      error.statusCode ??
      400,
    )
    .json({
      error:
        error.message,
      ...(error.details
        ? {
            details:
              error.details,
          }
        : {}),
    });

  return true;
}

export function registerGeometryImportRoutes(
  router,
  {
    geometryImportService,
    adminAuth,
    rejectWhileAdminTaskActive,
    operationAudit,
    jsonBody,
    maxBodyBytes,
    startAdminTask,
    progressLog,
  },
) {
  if (!geometryImportService) {
    return;
  }

  router.get(
    '/admin/geometry-import/pending',
    adminAuth
      .requireGeometryEditor,
    async (
      _request,
      response,
      next,
    ) => {
      try {
        const session =
          await geometryImportService
            .pending();

        response
          .set(
            'Cache-Control',
            'no-store',
          )
          .json({
            session,
          });
      } catch (error) {
        next(error);
      }
    },
  );

  router.delete(
    '/admin/geometry-import/:sessionId',
    adminAuth
      .requireGeometryEditor,
    rejectWhileAdminTaskActive,
    operationAudit(
      'geometry.import.discard',
    ),
    async (
      request,
      response,
      next,
    ) => {
      try {
        const sessionId =
          normalizeGeometryImportSessionId(
            request.params
              .sessionId,
          );

        const discarded =
          await geometryImportService
            .discard(
              sessionId,
            );

        if (!discarded) {
          response
            .status(404)
            .json({
              error:
                'Pending import session not found',
            });
          return;
        }

        response
          .set(
            'Cache-Control',
            'no-store',
          )
          .json({
            discarded,
          });
      } catch (error) {
        if (
          sendValidationError(
            response,
            error,
          )
        ) {
          return;
        }
        next(error);
      }
    },
  );

  router.post(
    '/admin/geometry-import/:sessionId/apply',
    adminAuth
      .requireGeometryEditor,
    rejectWhileAdminTaskActive,
    jsonBody(
      maxBodyBytes,
      'application/json',
    ),
    (
      request,
      response,
      next,
    ) => {
      let sessionId;

      try {
        sessionId =
          normalizeGeometryImportSessionId(
            request.params
              .sessionId,
          );
      } catch (error) {
        if (
          sendValidationError(
            response,
            error,
          )
        ) {
          return;
        }
        next(error);
        return;
      }

      if (
        !request.body ||
        !Array.isArray(
          request.body
            .decisions,
        )
      ) {
        response
          .status(400)
          .json({
            error:
              'decisions must be an array',
          });
        return;
      }

      startAdminTask(
        request,
        response,
        next,
        {
          type:
            'kml-update',
          endpoint:
            `/api/admin/geometry-import/${sessionId}/apply`,
          recordsSuccessfulUpdate:
            true,
          parameters: {
            importSessionId:
              sessionId,
            conflictDecisions:
              request.body
                .decisions
                .length,
          },
        },
        async (context) =>
          geometryImportService
            .apply(
              sessionId,
              request.body
                .decisions,
              {
                signal:
                  context.signal,
                onCommit: () =>
                  context
                    .beginCommit(),
                onProgress:
                  (progress) =>
                    progressLog(
                      context,
                      progress,
                    ),
              },
            ),
      );
    },
  );
}
