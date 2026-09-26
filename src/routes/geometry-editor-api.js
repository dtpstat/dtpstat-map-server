import express, {
  Router,
} from 'express';
import {
  createAdminOperationAudit,
  recordAdminOperationChanges,
  recordAdminOperationDetails,
} from '../http/admin-operation-audit.js';
import {
  GeometryEditorValidationError,
  normalizeGeometryId,
} from '../modules/geometry/editor-policy.js';

function validationError(
  response,
  error,
) {
  if (
    !(error instanceof
      GeometryEditorValidationError)
  ) {
    return false;
  }

  response
    .status(
      error.statusCode ??
      400,
    )
    .json({
      error:
        error.message,
      ...(error.details
        ? {
          details:
            error.details,
        }
        : {}),
    });

  return true;
}

function realtimeClientId(
  request,
) {
  const value =
    request.get?.(
      'x-dtpstat-realtime-client',
    );

  if (
    typeof value !== 'string' ||
    !value.trim()
  ) {
    return null;
  }

  return value
    .trim()
    .slice(
      0,
      128,
    );
}

function expectedRevision(
  request,
) {
  return (
    request.get?.(
      'x-dtpstat-base-revision',
    ) ??
    null
  );
}

function publishChange(
  realtimeEvents,
  request,
  definition,
) {
  realtimeEvents?.publish({
    resource:
      'city-geometries',
    permission:
      'geometry-editor',
    originClientId:
      realtimeClientId(
        request,
      ),
    message:
      'Геометрии изменены в другом сеансе.',
    ...definition,
  });
}

/**
 * @param {{
 *   geometryEditorService: {
 *     get: Function,
 *     recalculate: Function,
 *     listCities: Function,
 *     listCityGeometries: Function,
 *     create: Function,
 *     update: Function,
 *     updateMany: Function,
 *     delete: Function
 *   },
 *   adminAuth: any,
 *   securityService: any,
 *   maxBodyBytes?: number,
 *   afterRecalculate?: (details?: object) => Promise<any>,
 *   realtimeEvents?: { publish: Function }
 * }} dependencies
 */
export function createGeometryEditorRouter({
  geometryEditorService,
  adminAuth,
  securityService,
  maxBodyBytes =
    8 * 1024 * 1024,
  afterRecalculate =
    async () =>
      undefined,
  realtimeEvents,
}) {
  const router =
    Router();

  const jsonBody =
    express.json({
      limit:
        Math.min(
          maxBodyBytes,
          8 * 1024 * 1024,
        ),
      strict: true,
      inflate: true,
      type:
        'application/json',
    });

  const audit =
    (operation) =>
      createAdminOperationAudit(
        securityService,
        operation,
      );

  router.get(
    '/admin/geometry-editor/cities',
    adminAuth
      .requireGeometryEditor,
    async (
      _request,
      response,
      next,
    ) => {
      try {
        const result =
          await geometryEditorService
            .listCities();

        response
          .set(
            'Cache-Control',
            'no-store',
          )
          .json({
            cities:
              result.cities,
            cityLinkState:
              result.linkState,
          });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    '/admin/geometry-editor/cities/:cityId/geometries',
    adminAuth
      .requireGeometryEditor,
    async (
      request,
      response,
      next,
    ) => {
      try {
        const result =
          await geometryEditorService
            .listCityGeometries(
              request.params.cityId,
            );

        if (!result) {
          response
            .status(404)
            .json({
              error:
                'City not found or has no active boundary',
            });
          return;
        }

        response
          .set(
            'Cache-Control',
            'no-store',
          )
          .json(result);
      } catch (error) {
        if (
          validationError(
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

  router.get(
    '/admin/geometry-editor/geometries/:geometryId',
    adminAuth
      .requireGeometryEditor,
    async (
      request,
      response,
      next,
    ) => {
      try {
        const geometry =
          await geometryEditorService
            .get(
              request.params
                .geometryId,
            );

        if (!geometry) {
          response
            .status(404)
            .json({
              error:
                'Geometry not found',
            });
          return;
        }

        response
          .set(
            'Cache-Control',
            'no-store',
          )
          .json({
            geometry,
          });
      } catch (error) {
        if (
          validationError(
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

  router.post(
    '/admin/geometry-editor/geometries',
    adminAuth
      .requireGeometryEditor,
    audit(
      'geometry.create',
    ),
    jsonBody,
    async (
      request,
      response,
      next,
    ) => {
      try {
        const geometry =
          await geometryEditorService
            .create(
              request.body,
            );

        recordAdminOperationDetails(
          response,
          {
            geometryId:
              geometry.id,
            cityId:
              geometry.cityId,
            family:
              geometry.family,
          },
        );

        publishChange(
          realtimeEvents,
          request,
          {
            action:
              'create',
            entityIds:
              [geometry.id],
          },
        );

        response
          .set(
            'Cache-Control',
            'no-store',
          )
          .status(201)
          .json({
            geometry,
          });
      } catch (error) {
        if (
          validationError(
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
    '/admin/geometry-editor/geometries',
    adminAuth
      .requireGeometryEditor,
    audit(
      'geometry.bulk-update',
    ),
    jsonBody,
    async (
      request,
      response,
      next,
    ) => {
      try {
        const result =
          await geometryEditorService
            .updateMany(
              request.body,
            );

        recordAdminOperationDetails(
          response,
          {
            changedCount:
              result.changedCount,
            geometryIds:
              result.entityIds,
          },
        );

        if (
          result.changedCount > 0
        ) {
          publishChange(
            realtimeEvents,
            request,
            {
              action:
                'bulk-update',
              entityIds:
                result.entityIds,
            },
          );
        }

        response
          .set(
            'Cache-Control',
            'no-store',
          )
          .json(result);
      } catch (error) {
        if (
          validationError(
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
    '/admin/geometry-editor/geometries/:geometryId',
    adminAuth
      .requireGeometryEditor,
    audit(
      'geometry.update',
    ),
    jsonBody,
    async (
      request,
      response,
      next,
    ) => {
      try {
        const geometryId =
          normalizeGeometryId(
            request.params
              .geometryId,
          );

        const previous =
          await geometryEditorService
            .get(
              geometryId,
            );

        const geometry =
          await geometryEditorService
            .update(
              geometryId,
              request.body,
              {
                expectedUpdatedAt:
                  expectedRevision(
                    request,
                  ),
              },
            );

        if (!geometry) {
          response
            .status(404)
            .json({
              error:
                'Geometry not found',
            });
          return;
        }

        recordAdminOperationChanges(
          response,
          previous,
          geometry,
        );

        publishChange(
          realtimeEvents,
          request,
          {
            action:
              'update',
            entityIds:
              [geometry.id],
          },
        );

        response
          .set(
            'Cache-Control',
            'no-store',
          )
          .json({
            geometry,
          });
      } catch (error) {
        if (
          validationError(
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
    '/admin/geometry-editor/geometries/:geometryId',
    adminAuth
      .requireGeometryEditor,
    audit(
      'geometry.delete',
    ),
    async (
      request,
      response,
      next,
    ) => {
      try {
        const geometry =
          await geometryEditorService
            .delete(
              request.params
                .geometryId,
              {
                expectedUpdatedAt:
                  expectedRevision(
                    request,
                  ),
              },
            );

        if (!geometry) {
          response
            .status(404)
            .json({
              error:
                'Geometry not found',
            });
          return;
        }

        recordAdminOperationDetails(
          response,
          {
            geometryId:
              geometry.id,
            cityId:
              geometry.cityId,
            family:
              geometry.family,
            displayName:
              geometry.displayName,
          },
        );

        publishChange(
          realtimeEvents,
          request,
          {
            action:
              'delete',
            entityIds:
              [geometry.id],
          },
        );

        response
          .set(
            'Cache-Control',
            'no-store',
          )
          .json({
            deleted:
              geometry,
          });
      } catch (error) {
        if (
          validationError(
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

  router.post(
    '/admin/geometry-editor/merge',
    adminAuth
      .requireGeometryEditor,
    audit(
      'geometry.merge',
    ),
    jsonBody,
    async (
      request,
      response,
      next,
    ) => {
      try {
        const result =
          await geometryEditorService
            .merge(
              request.body,
            );

        recordAdminOperationDetails(
          response,
          {
            sourceGeometryIds:
              result
                .sourceGeometryIds,
            resultGeometryId:
              result
                .geometry
                .id,
            cityId:
              result
                .geometry
                .cityId,
            family:
              result
                .geometry
                .family,
          },
        );

        publishChange(
          realtimeEvents,
          request,
          {
            action:
              'merge',
            entityIds:
              result
                .sourceGeometryIds,
          },
        );

        response
          .set(
            'Cache-Control',
            'no-store',
          )
          .json(result);
      } catch (error) {
        if (
          validationError(
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

  router.post(
    '/admin/geometry-editor/geometries/:geometryId/cut',
    adminAuth
      .requireGeometryEditor,
    audit(
      'geometry.cut',
    ),
    jsonBody,
    async (
      request,
      response,
      next,
    ) => {
      try {
        const geometry =
          await geometryEditorService
            .cut(
              request.params
                .geometryId,
              request.body,
              {
                expectedUpdatedAt:
                  expectedRevision(
                    request,
                  ),
              },
            );

        if (!geometry) {
          response
            .status(404)
            .json({
              error:
                'Geometry not found',
            });
          return;
        }

        recordAdminOperationDetails(
          response,
          {
            geometryId:
              geometry.id,
            cityId:
              geometry.cityId,
            family:
              geometry.family,
          },
        );

        publishChange(
          realtimeEvents,
          request,
          {
            action:
              'cut',
            entityIds:
              [geometry.id],
          },
        );

        response
          .set(
            'Cache-Control',
            'no-store',
          )
          .json({
            geometry,
          });
      } catch (error) {
        if (
          validationError(
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

  router.post(
    '/admin/geometry-editor/recalculate',
    adminAuth
      .requireGeometryEditor,
    audit(
      'geometry.recalculate',
    ),
    async (
      _request,
      response,
      next,
    ) => {
      try {
        const statistics =
          await geometryEditorService
            .recalculate();

        const derived =
          await afterRecalculate({
            operation:
              'recalculate',
            cities:
              statistics.cities,
          });

        recordAdminOperationDetails(
          response,
          {
            cities:
              statistics.cities,
          },
        );

        response
          .set(
            'Cache-Control',
            'no-store',
          )
          .json({
            statistics,
            derived,
          });
      } catch (error) {
        if (
          validationError(
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
