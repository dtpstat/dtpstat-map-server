export function registerAdminTaskRoutes(router, {
  adminAuth,
  operationAudit,
  adminTasks,
  adminStatusURL,
  streamTransfer,
  osmCityUpdate,
  kmlUpdate,
}) {
  router.get(
    '/admin/config',
    adminAuth.requireData,
    (_request, response) => {
      response.set('Cache-Control', 'no-store');
      response.json({
        transfer: {
          requestCompression: ['gzip', 'deflate', 'br'],
          responseCompression: 'Accept-Encoding negotiation',
          portableFormats: ['json', 'zip-single-file'],
          streaming: true,
          zip: {
            entries: 1,
            zip64: false,
            compressionMethods: ['store', 'deflate'],
          },
          limits: {
            uploadBytes: streamTransfer.maxUploadBytes,
            decodedJsonBytes: streamTransfer.maxJsonBytes,
            itemBytes: streamTransfer.maxItemBytes,
          },
        },
        osmCityUpdate: {
          allowedURLs: [...osmCityUpdate.allowedURLs],
          defaults: {
            URL: osmCityUpdate.url,
            batchSize: osmCityUpdate.batchSize,
            minDelayMs: osmCityUpdate.minDelayMs,
            maxRetries: osmCityUpdate.maxRetries,
            retryBaseDelayMs: osmCityUpdate.retryBaseDelayMs,
            retryMaxDelayMs: osmCityUpdate.retryMaxDelayMs,
          },
          limits: {
            batchSize: { min: 1, max: osmCityUpdate.maxBatchSize },
            minDelayMs: { min: osmCityUpdate.minDelayMs, max: 300000 },
            maxRetries: { min: 0, max: osmCityUpdate.maxRetries },
            retryBaseDelayMs: {
              min: osmCityUpdate.retryBaseDelayMs,
              max: 3600000,
            },
            retryMaxDelayMs: {
              min: osmCityUpdate.retryMaxDelayMs,
              max: 3600000,
            },
          },
        },
        kmlUpdate: {
          defaults: { cityBufferMeters: kmlUpdate.cityBufferMeters },
          limits: {
            cityBufferMeters: {
              min: 0,
              max: kmlUpdate.cityBufferMaxMeters,
            },
          },
        },
      });
    },
  );

  router.get(
    '/admin/status',
    adminAuth.requireData,
    (request, response) => {
      const task = adminTasks.current();
      response.set('Cache-Control', 'no-store');
      response.json({
        status: task?.status ?? 'idle',
        taskId: task?.id ?? null,
        task: task ? {
          ...task,
          statusURL: adminStatusURL(request, task.id),
        } : null,
        lastSuccessfulUpdates: adminTasks.successfulUpdates(),
      });
    },
  );

  router.get(
    '/admin/status/:taskId',
    adminAuth.requireData,
    (request, response) => {
      const task = adminTasks.get(request.params.taskId);
      if (!task) {
        response.status(404).json({ error: 'Admin task not found' });
        return;
      }
      response.set('Cache-Control', 'no-store');
      response.json({
        status: task.status,
        taskId: task.id,
        lastSuccessfulUpdates: adminTasks.successfulUpdates(),
        task: {
          ...task,
          statusURL: adminStatusURL(request, task.id),
        },
      });
    },
  );

  const cancelAdminTask = (request, response) => {
    const taskId = request.params.taskId ?? adminTasks.active()?.id;
    if (!taskId) {
      response.status(404).json({ error: 'Active admin task not found' });
      return;
    }
    const cancellation = adminTasks.cancel(taskId);
    if (!cancellation) {
      response.status(404).json({ error: 'Admin task not found' });
      return;
    }
    const statusURL = adminStatusURL(request, taskId);
    response.set('Cache-Control', 'no-store');
    if (!cancellation.accepted) {
      response.status(409).json({
        error: 'Admin task is not active',
        taskId,
        status: cancellation.task.status,
        statusURL,
      });
      return;
    }
    response.status(202).json({ status: 'cancelling', statusURL, taskId });
  };

  router.post(
    '/admin/cancel',
    adminAuth.requireData,
    operationAudit('data.task.cancel'),
    cancelAdminTask,
  );
  router.post(
    '/admin/cancel/:taskId',
    adminAuth.requireData,
    operationAudit('data.task.cancel'),
    cancelAdminTask,
  );
}
