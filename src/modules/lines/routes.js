import { adminAuditPayloadFingerprint } from '../../shared/logging/admin-audit-details.js';
import {
  KmlUpdateValidationError,
  resolveKmlUpdateRequest,
} from './kml-update-options.js';

export function registerLineRoutes(router, {
  adminAuth,
  rejectWhileAdminTaskActive,
  clearCompletedAdminTask,
  jsonBody,
  kmlUpdate,
  startAdminTask,
  kmlUpdateService,
  progressLog,
}) {
  router.post(
    '/admin/update',
    adminAuth.requireData,
    rejectWhileAdminTaskActive,
    clearCompletedAdminTask,
    jsonBody(kmlUpdate.maxRequestBodyBytes, 'application/json'),
    (request, response, next) => {
      const hasRequestBody =
        request.get('transfer-encoding') !== undefined ||
        Number(request.get('content-length') ?? 0) > 0;
      if (hasRequestBody && request.body === undefined) {
        response.status(415).json({ error: 'Content-Type must be application/json' });
        return;
      }
      try {
        const options = resolveKmlUpdateRequest(
          request.body,
          request.query,
          kmlUpdate,
        );
        startAdminTask(request, response, next, {
          type: 'kml-update',
          endpoint: '/api/admin/update',
          recordsSuccessfulUpdate: !options.dryRun,
          parameters: {
            dryRun: options.dryRun,
            sourceCount: options.sources.length,
            cityBufferMeters: options.cityBufferMeters,
            ...(request.body !== undefined
              ? { payload: adminAuditPayloadFingerprint(request.body) }
              : {}),
          },
        }, async (context) => kmlUpdateService.update(
          request.body,
          request.query,
          {
            signal: context.signal,
            onCommit: () => context.beginCommit(),
            onProgress: (progress) => progressLog(context, progress),
          },
        ));
      } catch (error) {
        if (error instanceof KmlUpdateValidationError) {
          response.status(400).json({ error: error.message });
          return;
        }
        next(error);
      }
    },
  );
}
