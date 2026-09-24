import {
  CITY_MARKER_ICON,
} from '../../../public/js/city-marker-icon.js';

const DEFAULT_CITY_MARKER_PNG =
  Buffer.from(
    CITY_MARKER_ICON.split(',')[1],
    'base64',
  );

export function registerProjectPublicRoutes(
  router,
  {
    projectSettingsRepository,
  },
) {
  // In production this route is registered before the general API router, so
  // /api/config is backed by project settings. Small isolated repositories may
  // omit getPublicMapConfig and keep using the legacy test fallback route.
  if (
    typeof projectSettingsRepository
      .getPublicMapConfig ===
    'function'
  ) {
    router.get(
      '/config',
      async (
        _request,
        response,
        next,
      ) => {
        try {
          const map =
            await projectSettingsRepository
              .getPublicMapConfig();

          response.set(
            'Cache-Control',
            'no-cache',
          );
          response.json({ map });
        } catch (error) {
          next(error);
        }
      },
    );
  }

  router.get(
    '/city-marker-icon',
    async (
      _request,
      response,
      next,
    ) => {
      try {
        const icon =
          typeof projectSettingsRepository
            .getCityMarkerIcon ===
          'function'
            ? await projectSettingsRepository
              .getCityMarkerIcon()
            : null;

        response
          .set(
            'Cache-Control',
            'no-cache',
          )
          .type(
            icon?.mime ??
            'image/png',
          )
          .send(
            icon?.data ??
            DEFAULT_CITY_MARKER_PNG,
          );
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    '/project',
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
          'no-cache',
        );
        response.json(settings);
      } catch (error) {
        next(error);
      }
    },
  );
}
