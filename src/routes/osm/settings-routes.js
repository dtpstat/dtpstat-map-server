import {
  OsmCityUpdateValidationError,
} from '../../modules/osm/osm-city-update-options.js';
import {
  createAdminOperationAudit,
  recordAdminOperationChanges,
} from '../../http/admin-operation-audit.js';
import {
  normalizeOsmImportSettingsPayload,
} from '../../modules/osm/import-settings-policy.js';

export function registerOsmSettingsRoutes(
  router,
  {
    settingsRepository,
    adminAuth,
    securityService,
    osmConfig,
    jsonBody,
  },
) {
  const audit = (operation) =>
    createAdminOperationAudit(
      securityService,
      operation,
    );

  router.get(
    '/admin/osm-settings',
    adminAuth.requireOsmEditor,
    async (
      _request,
      response,
      next,
    ) => {
      try {
        const settings =
          await settingsRepository
            .get();

        response
          .set(
            'Cache-Control',
            'no-store',
          )
          .json({
            settings,
            allowedURLs: [
              ...osmConfig.allowedURLs,
            ],
            limits: {
              maxBatchSize:
                osmConfig.maxBatchSize,
              timeoutMs: 900000,
              queryTimeoutSeconds: 600,
              maxResponseBytes:
                512 * 1024 * 1024,
              maxTotalBytes:
                8 * 1024 * 1024 *
                1024,
              maxRetries: 20,
            },
          });
      } catch (error) {
        next(error);
      }
    },
  );

  router.put(
    '/admin/osm-settings',
    adminAuth.requireOsmEditor,
    audit(
      'data.osm-settings.update',
    ),
    jsonBody,
    async (
      request,
      response,
      next,
    ) => {
      try {
        const previous =
          await settingsRepository
            .get();

        const settings =
          await settingsRepository
            .save(
              normalizeOsmImportSettingsPayload(
                request.body,
                osmConfig,
              ),
            );

        recordAdminOperationChanges(
          response,
          previous,
          settings,
        );

        response
          .set(
            'Cache-Control',
            'no-store',
          )
          .json({ settings });
      } catch (error) {
        if (
          error instanceof
          OsmCityUpdateValidationError
        ) {
          response
            .status(400)
            .json({
              error: error.message,
            });
          return;
        }

        next(error);
      }
    },
  );
}
