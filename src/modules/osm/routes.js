import { adminAuditPayloadFingerprint } from '../../data/admin-audit-details.js';
import {
  OsmCityUpdateValidationError,
  resolveOsmCityUpdateRequest,
} from '../../data/osm-city-update-options.js';

export function registerOsmRoutes(router, {
  adminAuth,
  rejectWhileAdminTaskActive,
  clearCompletedAdminTask,
  operationAudit,
  jsonBody,
  osmCityUpdate,
  osmCityUpdateService,
  startAdminTask,
  parseBoolean,
  progressLog,
}) {
  router.get(
    '/admin/osm-checkpoint',
    adminAuth.requireData,
    async (_request, response, next) => {
      try {
        const checkpoint = await osmCityUpdateService.checkpointStatus();
        response.set('Cache-Control', 'no-store');
        response.json({ checkpoint });
      } catch (error) {
        next(error);
      }
    },
  );

  router.delete(
    '/admin/osm-checkpoint',
    adminAuth.requireData,
    rejectWhileAdminTaskActive,
    operationAudit('data.osm-checkpoint.discard'),
    async (_request, response, next) => {
      try {
        const checkpoint = await osmCityUpdateService.discardCheckpoint();
        response.set('Cache-Control', 'no-store');
        response.json({
          discarded: Boolean(checkpoint),
          checkpoint,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/admin/update/cities',
    adminAuth.requireData,
    rejectWhileAdminTaskActive,
    clearCompletedAdminTask,
    jsonBody(osmCityUpdate.maxRequestBodyBytes, 'application/json'),
    (request, response, next) => {
      const hasRequestBody =
        request.get('transfer-encoding') !== undefined ||
        Number(request.get('content-length') ?? 0) > 0;
      if (hasRequestBody && request.body === undefined) {
        response.status(415).json({ error: 'Content-Type must be application/json' });
        return;
      }
      try {
        const options = resolveOsmCityUpdateRequest(
          request.body,
          request.query,
          osmCityUpdate,
        );
        const resume = parseBoolean(request.query.resume, false);
        const restart = parseBoolean(request.query.restart, false);
        if (resume === null || restart === null) {
          response.status(400).json({
            error: 'resume and restart must be true or false',
          });
          return;
        }
        if (resume && restart) {
          response.status(400).json({
            error: 'resume and restart cannot both be true',
          });
          return;
        }
        startAdminTask(request, response, next, {
          type: 'osm-city-update',
          endpoint: '/api/admin/update/cities',
          recordsSuccessfulUpdate: !options.dryRun,
          parameters: {
            dryRun: options.dryRun,
            resume,
            restart,
            batchSize: options.batchSize,
            minDelayMs: options.minDelayMs,
            maxRetries: options.maxRetries,
            retryBaseDelayMs: options.retryBaseDelayMs,
            retryMaxDelayMs: options.retryMaxDelayMs,
            sourceURL: options.url,
            ...(request.body !== undefined
              ? { payload: adminAuditPayloadFingerprint(request.body) }
              : {}),
          },
        }, async (context) => osmCityUpdateService.update(
          request.body,
          request.query,
          {
            signal: context.signal,
            onCommit: () => context.beginCommit(),
            onProgress: (progress) => progressLog(context, progress),
          },
        ));
      } catch (error) {
        if (error instanceof OsmCityUpdateValidationError) {
          response.status(400).json({ error: error.message });
          return;
        }
        next(error);
      }
    },
  );
}
