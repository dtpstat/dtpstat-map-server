export function registerMapRoutes(router, {
  repository,
  publicMap,
  parseCoordinates,
}) {
  router.get('/config', (_request, response) => {
    response.set('Cache-Control', 'public, max-age=300');
    response.json({ map: publicMap });
  });

  router.get('/health', async (_request, response, next) => {
    try {
      await repository.health();
      response.set('Cache-Control', 'no-store');
      response.json({ status: 'ok', database: 'reachable' });
    } catch (error) {
      next(error);
    }
  });

  router.get('/cities', async (_request, response, next) => {
    try {
      const cities = await repository.listCities();
      response.set('Cache-Control', 'no-store');
      response.json({ cities });
    } catch (error) {
      next(error);
    }
  });

  router.get('/cities/:cityId/geometries', async (request, response, next) => {
    const cityId = Number(request.params.cityId);
    if (!Number.isSafeInteger(cityId) || cityId <= 0) {
      response.status(400).json({ error: 'cityId must be a positive integer' });
      return;
    }
    try {
      const geojson = await repository.getCityGeometries(cityId);
      if (!geojson) {
        response.status(404).json({ error: 'City not found' });
        return;
      }
      response.set('Cache-Control', 'public, max-age=3600');
      response.json(geojson);
    } catch (error) {
      next(error);
    }
  });

  router.get(
    '/geometry-timeline',
    async (
      _request,
      response,
      next,
    ) => {
      try {
        const timeline =
          typeof repository
            .getGeometryTimelineBounds ===
          'function'
            ? await repository
              .getGeometryTimelineBounds()
            : {
                minDate: null,
                maxDate: null,
              };

        response
          .set(
            'Cache-Control',
            'no-cache',
          )
          .json(timeline);
      } catch (error) {
        next(error);
      }
    },
  );

  router.get('/geometries', async (request, response, next) => {
    const zoom =
      request.query.zoom ===
        undefined
        ? 8
        : Number(
            request.query.zoom,
          );
    if (
      !Number.isFinite(zoom) ||
      zoom < 0 ||
      zoom > 24
    ) {
      response.status(400).json({
        error:
          'zoom must be a number between 0 and 24',
      });
      return;
    }

    const bbox =
      parseCoordinates(
        request.query.bbox,
        4,
      );
    const maxLongitudeSpan =
      zoom < 8
        ? 360
        : 20;
    const maxLatitudeSpan =
      zoom < 8
        ? 180
        : 20;
    if (
      !bbox ||
      bbox[0] < -180 || bbox[2] > 180 ||
      bbox[1] < -90 || bbox[3] > 90 ||
      bbox[0] >= bbox[2] || bbox[1] >= bbox[3] ||
      bbox[2] - bbox[0] >
        maxLongitudeSpan ||
      bbox[3] - bbox[1] >
        maxLatitudeSpan
    ) {
      response.status(400).json({
        error:
          'bbox must be a valid WGS84 visible window for the requested zoom',
      });
      return;
    }

    const center = request.query.center === undefined
      ? [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2]
      : parseCoordinates(request.query.center, 2);
    if (
      !center ||
      center[0] < bbox[0] || center[0] > bbox[2] ||
      center[1] < bbox[1] || center[1] > bbox[3]
    ) {
      response.status(400).json({ error: 'center must be lng,lat inside bbox' });
      return;
    }

    try {
      const geojson = await repository.getViewportGeometries({
        west: bbox[0],
        south: bbox[1],
        east: bbox[2],
        north: bbox[3],
        centerLng: center[0],
        centerLat: center[1],
        zoom,
      });
      response.set('Cache-Control', 'no-store');
      response.json(geojson);
    } catch (error) {
      next(error);
    }
  });
}
