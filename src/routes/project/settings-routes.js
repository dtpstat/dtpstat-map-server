import {
  CITY_MARKER_ICON_MAX_BYTES,
} from '../../modules/project/city-marker-icon.js';
import {
  MapboxAccessTokenValidationError,
} from '../../modules/project/mapbox-token-policy.js';
import {
  PROJECT_CONTENT_CLASSES,
  PROJECT_CONTENT_TAGS,
  PUBLIC_THEME_PRESETS,
  ProjectSettingsValidationError,
} from '../../modules/project/settings-policy.js';
import {
  PUBLIC_DOWNLOAD_NAME_MAX_LENGTH,
} from '../../modules/project/public-download-policy.js';
import {
  createAdminOperationAudit,
  recordAdminOperationChanges,
} from '../../http/admin-operation-audit.js';

export function registerProjectSettingsAdminRoutes(
  router,
  {
    projectSettingsRepository,
    adminAuth,
    securityService,
    jsonBody,
    afterSettingsSave,
  },
) {
  router.get(
    '/admin/project-settings',
    adminAuth.requireInterface,
    async (
      _request,
      response,
      next,
    ) => {
      try {
        const settings =
          await projectSettingsRepository
            .get();

        response.set(
          'Cache-Control',
          'no-store',
        );

        response.json({
          settings,
          editor: {
            tags:
              PROJECT_CONTENT_TAGS,
            classes:
              PROJECT_CONTENT_CLASSES,
            themes:
              PUBLIC_THEME_PRESETS,
            publicDownloadName: {
              maxLength:
                PUBLIC_DOWNLOAD_NAME_MAX_LENGTH,
            },
            cityMarkerIcon: {
              mime: 'image/png',
              maxBytes:
                CITY_MARKER_ICON_MAX_BYTES,
              minSize: 16,
              maxSize: 256,
              square: true,
            },
          },
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.put(
    '/admin/project-settings',
    adminAuth.requireInterface,
    createAdminOperationAudit(
      securityService,
      'interface.project.update',
    ),
    jsonBody,
    async (request, response, next) => {
      try {
        const previousSettings =
          await projectSettingsRepository
            .get();

        const settings =
          await projectSettingsRepository
            .save(request.body);

        const derived =
          await afterSettingsSave?.();

        recordAdminOperationChanges(
          response,
          previousSettings,
          settings,
        );

        response.set(
          'Cache-Control',
          'no-store',
        );

        response.json({
          settings,
          derived,
        });
      } catch (error) {
        if (
          error instanceof
            ProjectSettingsValidationError ||
          error instanceof
            MapboxAccessTokenValidationError
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
