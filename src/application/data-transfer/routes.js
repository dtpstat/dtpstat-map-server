export function registerDataExportRoutes(router, {
  exportRepository,
  adminAuth,
  operationAudit,
  streamingExportRoute,
}) {
  const cityStream = exportRepository?.streamCityBoundaries?.bind(
    exportRepository,
  );
  const lineStream = exportRepository?.streamLines?.bind(exportRepository);
  const populationStream = exportRepository?.streamPopulations?.bind(
    exportRepository,
  );

  router.get(
    '/admin/export/cities',
    adminAuth.requireData,
    operationAudit('data.export.cities'),
    streamingExportRoute(
      'cities.geojson',
      'application/geo+json',
      cityStream,
      () => exportRepository.exportCityBoundaries(),
    ),
  );
  router.get(
    '/admin/export/cities.zip',
    adminAuth.requireData,
    operationAudit('data.export.cities-zip'),
    streamingExportRoute(
      'cities.geojson',
      'application/geo+json',
      cityStream,
      () => exportRepository.exportCityBoundaries(),
      true,
    ),
  );
  router.get(
    '/admin/export/lines',
    adminAuth.requireData,
    operationAudit('data.export.lines'),
    streamingExportRoute(
      'lines.geojson',
      'application/geo+json',
      lineStream,
      () => exportRepository.exportLines(),
    ),
  );
  router.get(
    '/admin/export/lines.zip',
    adminAuth.requireData,
    operationAudit('data.export.lines-zip'),
    streamingExportRoute(
      'lines.geojson',
      'application/geo+json',
      lineStream,
      () => exportRepository.exportLines(),
      true,
    ),
  );
  router.get(
    '/admin/export/populations',
    adminAuth.requireData,
    operationAudit('data.export.populations'),
    streamingExportRoute(
      'populations.json',
      'application/json',
      populationStream,
      () => exportRepository.exportPopulations(),
    ),
  );
  router.get(
    '/admin/export/populations.zip',
    adminAuth.requireData,
    operationAudit('data.export.populations-zip'),
    streamingExportRoute(
      'populations.json',
      'application/json',
      populationStream,
      () => exportRepository.exportPopulations(),
      true,
    ),
  );
}

export function registerDataImportRoutes(router, {
  importService,
  cityBoundaryTransferService,
  adminAuth,
  rejectWhileAdminTaskActive,
  clearCompletedAdminTask,
  receivePortableUpload,
  startAdminTask,
  executePortableUpload,
  portableServiceMethod,
  removeStreamUpload,
  parseBoolean,
}) {
  const importLines = async (request, response, next) => {
    const upload = await receivePortableUpload(request, response, next);
    if (!upload) return;
    const task = startAdminTask(request, response, next, {
      type: 'geojson-import',
      endpoint: '/api/admin/import/lines',
      recordsSuccessfulUpdate: true,
      parameters: {
        transport: upload.contentType,
        contentEncoding: upload.contentEncoding,
        uploadBytes: upload.bytes,
        uploadSha256: upload.sha256,
      },
    }, async (context) => executePortableUpload(
      upload,
      context,
      portableServiceMethod(
        importService,
        'replaceFromGeoJsonStream',
      ),
    ));
    if (!task) await removeStreamUpload(upload).catch(() => {});
  };

  router.post(
    '/admin/import',
    adminAuth.requireData,
    rejectWhileAdminTaskActive,
    clearCompletedAdminTask,
    importLines,
  );
  router.post(
    '/admin/import/lines',
    adminAuth.requireData,
    rejectWhileAdminTaskActive,
    clearCompletedAdminTask,
    importLines,
  );

  router.post(
    '/admin/import/cities',
    adminAuth.requireData,
    rejectWhileAdminTaskActive,
    clearCompletedAdminTask,
    async (request, response, next) => {
      const dryRun = parseBoolean(request.query.dryRun, false);
      if (dryRun === null) {
        response.status(400).json({ error: 'dryRun must be true or false' });
        return;
      }
      const upload = await receivePortableUpload(request, response, next);
      if (!upload) return;
      const task = startAdminTask(request, response, next, {
        type: 'city-geojson-import',
        endpoint: '/api/admin/import/cities',
        recordsSuccessfulUpdate: !dryRun,
        parameters: {
          dryRun,
          transport: upload.contentType,
          contentEncoding: upload.contentEncoding,
          uploadBytes: upload.bytes,
          uploadSha256: upload.sha256,
        },
      }, async (context) => executePortableUpload(
        upload,
        context,
        portableServiceMethod(
          cityBoundaryTransferService,
          'replaceFromGeoJsonStream',
        ),
        { dryRun },
      ));
      if (!task) await removeStreamUpload(upload).catch(() => {});
    },
  );
}

export function registerPopulationRoutes(router, {
  populationService,
  adminAuth,
  rejectWhileAdminTaskActive,
  clearCompletedAdminTask,
  receivePortableUpload,
  startAdminTask,
  executePortableUpload,
  portableServiceMethod,
  removeStreamUpload,
}) {
  router.post(
    '/admin/populations',
    adminAuth.requireData,
    rejectWhileAdminTaskActive,
    clearCompletedAdminTask,
    async (request, response, next) => {
      const upload = await receivePortableUpload(request, response, next);
      if (!upload) return;
      const task = startAdminTask(request, response, next, {
        type: 'population-update',
        endpoint: '/api/admin/populations',
        recordsSuccessfulUpdate: true,
        parameters: {
          transport: upload.contentType,
          contentEncoding: upload.contentEncoding,
          uploadBytes: upload.bytes,
          uploadSha256: upload.sha256,
        },
      }, async (context) => executePortableUpload(
        upload,
        context,
        portableServiceMethod(
          populationService,
          'updateFromJsonStream',
        ),
      ));
      if (!task) await removeStreamUpload(upload).catch(() => {});
    },
  );
}
