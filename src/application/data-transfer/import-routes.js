export function registerDataImportRoutes(
  router,
  {
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
  },
) {
  const importLines =
    async (
      request,
      response,
      next,
    ) => {
      const upload =
        await receivePortableUpload(
          request,
          response,
          next,
        );

      if (!upload) return;

      const task =
        startAdminTask(
          request,
          response,
          next,
          {
            type:
              'geojson-import',
            endpoint:
              '/api/admin/import/lines',
            recordsSuccessfulUpdate:
              true,
            parameters: {
              transport:
                upload.contentType,
              contentEncoding:
                upload
                  .contentEncoding,
              uploadBytes:
                upload.bytes,
              uploadSha256:
                upload.sha256,
            },
          },
          async (context) =>
            executePortableUpload(
              upload,
              context,
              portableServiceMethod(
                importService,
                'replaceFromGeoJsonStream',
              ),
            ),
        );

      if (!task) {
        await removeStreamUpload(
          upload,
        ).catch(() => {});
      }
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
    async (
      request,
      response,
      next,
    ) => {
      const dryRun =
        parseBoolean(
          request.query.dryRun,
          false,
        );

      if (dryRun === null) {
        response
          .status(400)
          .json({
            error:
              'dryRun must be true or false',
          });
        return;
      }

      const upload =
        await receivePortableUpload(
          request,
          response,
          next,
        );

      if (!upload) return;

      const task =
        startAdminTask(
          request,
          response,
          next,
          {
            type:
              'city-geojson-import',
            endpoint:
              '/api/admin/import/cities',
            recordsSuccessfulUpdate:
              !dryRun,
            parameters: {
              dryRun,
              transport:
                upload.contentType,
              contentEncoding:
                upload
                  .contentEncoding,
              uploadBytes:
                upload.bytes,
              uploadSha256:
                upload.sha256,
            },
          },
          async (context) =>
            executePortableUpload(
              upload,
              context,
              portableServiceMethod(
                cityBoundaryTransferService,
                'replaceFromGeoJsonStream',
              ),
              {dryRun},
            ),
        );

      if (!task) {
        await removeStreamUpload(
          upload,
        ).catch(() => {});
      }
    },
  );
}
