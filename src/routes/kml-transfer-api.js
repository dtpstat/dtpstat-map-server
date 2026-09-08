import express, { Router } from 'express';
import { adminAuditPayloadFingerprint } from '../data/admin-audit-details.js';
import { AdminTaskAlreadyRunningError } from '../data/admin-task-manager.js';
import {
  KmlTransferValidationError,
  parseLinesKml,
  serializeLinesKml,
} from '../data/kml-transfer.js';
import {
  adminClientIp,
  createAdminOperationAudit,
} from '../http/admin-auth.js';

/**
 * Portable KML transfer is deliberately separate from the external Google My
 * Maps updater. It carries a complete business line type/style dictionary and
 * uses KML LineString/MultiGeometry only for geometry.
 *
 * @param {{
 *   exportRepository: { exportLines: () => Promise<object> },
 *   importService: { replaceFromGeoJson: (collection: unknown, operation?: object) => Promise<object> },
 *   adminTasks: ReturnType<import('../data/admin-task-manager.js').createAdminTaskManager>,
 *   adminAuth: ReturnType<import('../http/admin-auth.js').createAdminAuthorization>,
 *   securityService: ReturnType<import('../data/admin-security.js').createAdminSecurityService>,
 *   maxBodyBytes: number
 * }} dependencies
 */
export function createKmlTransferRouter({
  exportRepository,
  importService,
  adminTasks,
  adminAuth,
  securityService,
  maxBodyBytes,
}) {
  const router = Router();

  function activeTaskResponse(request, response, task) {
    const statusURL = `${request.baseUrl}/admin/status/${task.id}`;
    response.set('Cache-Control', 'no-store');
    response.status(409).json({
      error: 'Another data-management task is already active',
      taskId: task.id,
      task: { id: task.id, type: task.type, status: task.status },
      statusURL,
    });
  }

  router.get(
    '/admin/export/lines.kml',
    adminAuth.requireData,
    createAdminOperationAudit(securityService, 'data.export.lines-kml'),
    async (_request, response, next) => {
      try {
        const geojson = await exportRepository.exportLines();
        const kml = serializeLinesKml(geojson);
        response
          .set('Cache-Control', 'no-store')
          .set('Content-Disposition', 'attachment; filename="lines.kml"')
          .type('application/vnd.google-earth.kml+xml')
          .send(kml);
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/admin/import/lines.kml',
    adminAuth.requireData,
    (request, response, next) => {
      const activeTask = adminTasks.active();
      if (!activeTask) {
        next();
        return;
      }
      activeTaskResponse(request, response, activeTask);
    },
    express.text({
      limit: maxBodyBytes,
      inflate: true,
      type: [
        'application/vnd.google-earth.kml+xml',
        'application/xml',
        'text/xml',
      ],
    }),
    (request, response, next) => {
      if (typeof request.body !== 'string') {
        response.status(415).json({
          error: 'Content-Type must be application/vnd.google-earth.kml+xml, application/xml or text/xml',
        });
        return;
      }

      let collection;
      try {
        collection = parseLinesKml(request.body);
      } catch (error) {
        if (error instanceof KmlTransferValidationError) {
          response.status(400).json({ error: error.message });
          return;
        }
        next(error);
        return;
      }

      try {
        const task = adminTasks.start(
          {
            type: 'kml-update',
            endpoint: '/api/admin/import/lines.kml',
            recordsSuccessfulUpdate: true,
            actor: {
              userId: request.adminUser.id,
              username: request.adminUser.username,
              ipAddress: adminClientIp(request),
            },
            parameters: {
              mode: 'portable-kml',
              features: collection.features.length,
              businessLineTypes: collection.lineTypes.length,
              payload: adminAuditPayloadFingerprint(request.body),
            },
          },
          async (context) => importService.replaceFromGeoJson(collection, {
            signal: context.signal,
            onCommit: () => context.beginCommit(),
            onProgress: (progress) => context.log(
              progress.phase === 'validated'
                ? 'KML: словарь бизнес-типов и геометрии проверены'
                : progress.phase === 'database'
                  ? 'KML: изменения базы данных подготовлены'
                  : `KML: ${progress.phase}`,
              progress,
            ),
          }),
        );
        const statusURL = `${request.baseUrl}/admin/status/${task.id}`;
        response
          .set('Cache-Control', 'no-store')
          .location(statusURL)
          .status(202)
          .json({
            status: 'accepted',
            taskId: task.id,
            task: { ...task, statusURL },
          });
      } catch (error) {
        if (error instanceof AdminTaskAlreadyRunningError) {
          activeTaskResponse(request, response, error.task);
          return;
        }
        next(error);
      }
    },
  );

  return router;
}
