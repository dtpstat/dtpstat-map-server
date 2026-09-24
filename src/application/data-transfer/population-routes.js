export function registerPopulationRoutes(
  router,
  {
    populationService,
    adminAuth,
    rejectWhileAdminTaskActive,
    clearCompletedAdminTask,
    receivePortableUpload,
    startAdminTask,
    executePortableUpload,
    portableServiceMethod,
    removeStreamUpload,
  },
) {
  router.post(
    '/admin/populations',
    adminAuth.requireData,
    rejectWhileAdminTaskActive,
    clearCompletedAdminTask,
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
              'population-update',
            endpoint:
              '/api/admin/populations',
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
                populationService,
                'updateFromJsonStream',
              ),
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
