import {
  Router,
} from 'express';
import {
  jsonBody,
} from '../http/admin-json-body.js';
import {
  createAdminOperationAudit,
  recordAdminOperationChanges,
  recordAdminOperationDetails,
} from '../http/admin-operation-audit.js';
import {
  PointTypeValidationError,
} from '../modules/points/type-policy.js';

function validation(
  response,
  error,
) {
  if (
    !(error instanceof
      PointTypeValidationError)
  ) {
    return false;
  }
  response
    .status(400)
    .json({
      error:
        error.message,
    });
  return true;
}

export function createPointTypesRouter({
  pointTypesRepository,
  adminAuth,
  securityService,
  maxBodyBytes,
}) {
  const router =
    Router();
  const body =
    jsonBody(
      Math.min(
        maxBodyBytes,
        64 * 1024,
      ),
      'application/json',
    );

  router.get(
    '/point-types',
    async (
      _request,
      response,
      next,
    ) => {
      try {
        response
          .set(
            'Cache-Control',
            'no-store',
          )
          .json({
            pointTypes:
              await pointTypesRepository
                .list(),
          });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/admin/point-types',
    adminAuth.requireInterface,
    createAdminOperationAudit(
      securityService,
      'interface.point-types.create',
    ),
    body,
    async (
      request,
      response,
      next,
    ) => {
      try {
        const pointType =
          await pointTypesRepository
            .create(
              request.body,
            );
        recordAdminOperationChanges(
          response,
          null,
          {
            pointType,
          },
        );
        response
          .status(201)
          .set(
            'Cache-Control',
            'no-store',
          )
          .json({
            pointType,
          });
      } catch (error) {
        if (
          validation(
            response,
            error,
          )
        ) {
          return;
        }
        next(error);
      }
    },
  );

  router.patch(
    '/admin/point-types/:pointTypeId',
    adminAuth.requireInterface,
    createAdminOperationAudit(
      securityService,
      'interface.point-types.update',
    ),
    body,
    async (
      request,
      response,
      next,
    ) => {
      try {
        const before =
          (
            await pointTypesRepository
              .list()
          ).find(
            (item) =>
              String(item.id) ===
              String(
                request.params
                  .pointTypeId,
              ),
          ) ??
          null;
        const pointType =
          await pointTypesRepository
            .update(
              request.params
                .pointTypeId,
              request.body,
            );
        if (!pointType) {
          response
            .status(404)
            .json({
              error:
                'Point type not found',
            });
          return;
        }
        recordAdminOperationChanges(
          response,
          { pointType: before },
          { pointType },
        );
        response
          .set(
            'Cache-Control',
            'no-store',
          )
          .json({
            pointType,
          });
      } catch (error) {
        if (
          validation(
            response,
            error,
          )
        ) {
          return;
        }
        next(error);
      }
    },
  );

  router.delete(
    '/admin/point-types/:pointTypeId',
    adminAuth.requireInterface,
    createAdminOperationAudit(
      securityService,
      'interface.point-types.delete',
    ),
    async (
      request,
      response,
      next,
    ) => {
      try {
        const deleted =
          await pointTypesRepository
            .delete(
              request.params
                .pointTypeId,
            );
        if (!deleted) {
          response
            .status(404)
            .json({
              error:
                'Point type not found',
            });
          return;
        }
        recordAdminOperationDetails(
          response,
          {
            pointTypeId:
              deleted.id,
            pointTypeName:
              deleted.name,
            unlinkedGeometryCount:
              deleted
                .unlinkedGeometryCount,
            hadIcon:
              Boolean(
                deleted.iconFileName,
              ),
          },
        );
        response
          .status(200)
          .set(
            'Cache-Control',
            'no-store',
          )
          .json({
            deleted: true,
            pointTypeId:
              deleted.id,
            unlinkedGeometryCount:
              deleted
                .unlinkedGeometryCount,
          });
      } catch (error) {
        if (
          validation(
            response,
            error,
          )
        ) {
          return;
        }
        next(error);
      }
    },
  );

  return router;
}
