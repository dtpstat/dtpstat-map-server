import {
  CityMarkerIconValidationError,
  validateCityMarkerIcon,
} from '../../data/city-marker-icon.js';
import {
  createAdminOperationAudit,
  recordAdminOperationChanges,
} from '../../http/admin-operation-audit.js';

export function registerProjectCityMarkerRoutes(
  router,
  {
    projectSettingsRepository,
    adminAuth,
    securityService,
    cityMarkerBody,
  },
) {
  if (
    typeof projectSettingsRepository
      .saveCityMarkerIcon ===
    'function'
  ) {
    router.put(
      '/admin/project-settings/city-marker-icon',
      adminAuth.requireInterface,
      createAdminOperationAudit(
        securityService,
        'interface.project.city-marker-icon.update',
      ),
      cityMarkerBody,
      async (
        request,
        response,
        next,
      ) => {
        try {
          const previousIcon =
            typeof projectSettingsRepository
              .getCityMarkerIcon ===
            'function'
              ? await projectSettingsRepository
                .getCityMarkerIcon()
              : null;

          const icon =
            validateCityMarkerIcon(
              request.body,
              request.get(
                'content-type',
              ),
            );

          const settings =
            await projectSettingsRepository
              .saveCityMarkerIcon(
                icon,
              );

          recordAdminOperationChanges(
            response,
            {
              cityMarkerIcon:
                previousIcon
                  ? {
                    custom: true,
                    mime:
                      previousIcon.mime,
                    bytes:
                      previousIcon
                        .data
                        ?.length ??
                      null,
                  }
                  : {
                    custom: false,
                  },
            },
            {
              cityMarkerIcon: {
                custom: true,
                mime: icon.mime,
                width: icon.width,
                height: icon.height,
                bytes:
                  icon.data.length,
              },
            },
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
            CityMarkerIconValidationError
          ) {
            response
              .status(400)
              .json({
                error:
                  error.message,
              });
            return;
          }

          next(error);
        }
      },
    );
  }

  if (
    typeof projectSettingsRepository
      .clearCityMarkerIcon ===
    'function'
  ) {
    router.delete(
      '/admin/project-settings/city-marker-icon',
      adminAuth.requireInterface,
      createAdminOperationAudit(
        securityService,
        'interface.project.city-marker-icon.reset',
      ),
      async (
        _request,
        response,
        next,
      ) => {
        try {
          const previousIcon =
            typeof projectSettingsRepository
              .getCityMarkerIcon ===
            'function'
              ? await projectSettingsRepository
                .getCityMarkerIcon()
              : null;

          const settings =
            await projectSettingsRepository
              .clearCityMarkerIcon();

          recordAdminOperationChanges(
            response,
            {
              cityMarkerIcon:
                previousIcon
                  ? {
                    custom: true,
                    mime:
                      previousIcon.mime,
                    bytes:
                      previousIcon
                        .data
                        ?.length ??
                      null,
                  }
                  : {
                    custom: false,
                  },
            },
            {
              cityMarkerIcon: {
                custom: false,
              },
            },
          );

          response
            .set(
              'Cache-Control',
              'no-store',
            )
            .json({ settings });
        } catch (error) {
          next(error);
        }
      },
    );
  }
}
