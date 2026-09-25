import express from 'express';
import {
  adminAuditPayloadFingerprint,
} from '../../shared/logging/admin-audit-details.js';
import {
  KmlTransferValidationError,
  parseLinesKml,
} from '../../modules/lines/kml-transfer.js';

export function registerKmlImportRoutes(
  router,
  {
    importService,
    adminAuth,
    maxBodyBytes,
    rejectWhileAdminTaskActive,
    startAdminTask,
  },
) {
  router.post(
    '/admin/import/lines.kml',
    adminAuth.requireData,
    rejectWhileAdminTaskActive,
    express.text({
      limit: maxBodyBytes,
      inflate: true,
      type: [
        'application/vnd.google-earth.kml+xml',
        'application/xml',
        'text/xml',
      ],
    }),
    (
      request,
      response,
      next,
    ) => {
      if (
        typeof request.body !==
        'string'
      ) {
        response
          .status(415)
          .json({
            error:
              'Content-Type must be application/vnd.google-earth.kml+xml, application/xml or text/xml',
          });
        return;
      }

      let collection;

      try {
        collection =
          parseLinesKml(
            request.body,
          );
      } catch (error) {
        if (
          error instanceof
          KmlTransferValidationError
        ) {
          response
            .status(400)
            .json({
              error: error.message,
            });
          return;
        }

        next(error);
        return;
      }

      startAdminTask(
        request,
        response,
        next,
        {
          type: 'kml-update',
          endpoint:
            '/api/admin/import/lines.kml',
          recordsSuccessfulUpdate:
            true,
          parameters: {
            mode:
              'portable-kml',
            features:
              collection
                .features.length,
            businessLineTypes:
              collection
                .lineTypes.length,
            payload:
              adminAuditPayloadFingerprint(
                request.body,
              ),
          },
        },
        async (context) =>
          importService
            .replaceFromGeoJson(
              collection,
              {
                signal:
                  context.signal,
                onCommit: () =>
                  context
                    .beginCommit(),
                onProgress:
                  (progress) =>
                    context.log(
                      progress.phase ===
                        'validated'
                        ? 'KML: словарь бизнес-типов и геометрии проверены'
                        : progress.phase ===
                            'database'
                          ? 'KML: изменения базы данных подготовлены'
                          : `KML: ${progress.phase}`,
                      progress,
                    ),
              },
            ),
      );
    },
  );
}
