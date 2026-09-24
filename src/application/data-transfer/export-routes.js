export function registerDataExportRoutes(
  router,
  {
    exportRepository,
    adminAuth,
    operationAudit,
    streamingExportRoute,
  },
) {
  const cityStream =
    exportRepository
      ?.streamCityBoundaries
      ?.bind(exportRepository);
  const lineStream =
    exportRepository
      ?.streamLines
      ?.bind(exportRepository);
  const populationStream =
    exportRepository
      ?.streamPopulations
      ?.bind(exportRepository);

  router.get(
    '/admin/export/cities',
    adminAuth.requireData,
    operationAudit(
      'data.export.cities',
    ),
    streamingExportRoute(
      'cities.geojson',
      'application/geo+json',
      cityStream,
      () =>
        exportRepository
          .exportCityBoundaries(),
    ),
  );

  router.get(
    '/admin/export/cities.zip',
    adminAuth.requireData,
    operationAudit(
      'data.export.cities-zip',
    ),
    streamingExportRoute(
      'cities.geojson',
      'application/geo+json',
      cityStream,
      () =>
        exportRepository
          .exportCityBoundaries(),
      true,
    ),
  );

  router.get(
    '/admin/export/lines',
    adminAuth.requireData,
    operationAudit(
      'data.export.lines',
    ),
    streamingExportRoute(
      'lines.geojson',
      'application/geo+json',
      lineStream,
      () =>
        exportRepository
          .exportLines(),
    ),
  );

  router.get(
    '/admin/export/lines.zip',
    adminAuth.requireData,
    operationAudit(
      'data.export.lines-zip',
    ),
    streamingExportRoute(
      'lines.geojson',
      'application/geo+json',
      lineStream,
      () =>
        exportRepository
          .exportLines(),
      true,
    ),
  );

  router.get(
    '/admin/export/populations',
    adminAuth.requireData,
    operationAudit(
      'data.export.populations',
    ),
    streamingExportRoute(
      'populations.json',
      'application/json',
      populationStream,
      () =>
        exportRepository
          .exportPopulations(),
    ),
  );

  router.get(
    '/admin/export/populations.zip',
    adminAuth.requireData,
    operationAudit(
      'data.export.populations-zip',
    ),
    streamingExportRoute(
      'populations.json',
      'application/json',
      populationStream,
      () =>
        exportRepository
          .exportPopulations(),
      true,
    ),
  );
}
