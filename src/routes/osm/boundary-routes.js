import {
  createAdminOperationAudit,
  recordAdminOperationChanges,
  recordAdminOperationDetails,
} from '../../http/admin-operation-audit.js';
import {
  OsmBoundaryAdminValidationError,
} from '../../modules/osm/boundary-admin-policy.js';

function object(value) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value)
  );
}

function realtimeClientId(request) {
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
  return value.trim().slice(0, 128);
}

function validationError(
  response,
  error,
) {
  if (
    !(error instanceof
      OsmBoundaryAdminValidationError)
  ) {
    return false;
  }
  response
    .status(error.statusCode)
    .json({
      error: error.message,
      ...(error.details
        ? { details: error.details }
        : {}),
    });
  return true;
}

export function registerOsmBoundaryRoutes(
  router,
  {
    boundaryRepository,
    adminAuth,
    securityService,
    jsonBody,
    afterBoundaryChange,
    realtimeEvents,
  },
) {
  const audit = (operation) =>
    createAdminOperationAudit(
      securityService,
      operation,
    );

  router.get(
    '/admin/osm-boundaries',
    adminAuth.requireOsmEditor,
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
            boundaries:
              await boundaryRepository
                .list(),
          });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    '/admin/osm-boundaries/:boundaryId/geometry',
    adminAuth.requireOsmEditor,
    async (
      request,
      response,
      next,
    ) => {
      try {
        const feature =
          await boundaryRepository
            .getGeometry(
              request.params
                .boundaryId,
            );

        if (!feature) {
          response
            .status(404)
            .json({
              error:
                'OSM boundary not found',
            });
          return;
        }

        response
          .set(
            'Cache-Control',
            'no-store',
          )
          .json(feature);
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
    '/admin/osm-boundaries/:boundaryId/subtree',
    adminAuth.requireOsmEditor,
    audit(
      'data.osm-boundary.subtree-active',
    ),
    jsonBody,
    async (
      request,
      response,
      next,
    ) => {
      try {
        if (
          !object(request.body) ||
          typeof request.body.active !==
            'boolean'
        ) {
          throw new OsmBoundaryAdminValidationError(
            'Request body must contain boolean active',
          );
        }

        const unknown =
          Object.keys(request.body)
            .filter(
              (key) =>
                key !== 'active',
            );

        if (unknown.length > 0) {
          throw new OsmBoundaryAdminValidationError(
            'Unsupported subtree fields: ' +
            unknown.join(', '),
          );
        }

        const result =
          await boundaryRepository
            .setSubtreeActive(
              request.params
                .boundaryId,
              request.body.active,
            );

        if (!result) {
          response
            .status(404)
            .json({
              error:
                'OSM boundary not found',
            });
          return;
        }

        const derived =
          result.changedCount > 0
            ? await afterBoundaryChange?.()
            : undefined;

        if (
          result.changedCount > 0
        ) {
          realtimeEvents?.publish({
            resource:
              'osm-boundaries',
            action:
              'subtree-active',
            entityIds:
              result.entityIds,
            permission:
              'osm-editor',
            originClientId:
              realtimeClientId(
                request,
              ),
            message:
              'Активность ветки OSM изменена в другом сеансе.',
          });
        }

        recordAdminOperationDetails(
          response,
          {
            rootBoundaryId:
              result.root.id,
            rootDisplayName:
              result.root
                .displayName,
            active:
              result.active,
            affectedCount:
              result.affectedCount,
            changedCount:
              result.changedCount,
            previousActiveCount:
              result
                .previousActiveCount,
            previousInactiveCount:
              result
                .previousInactiveCount,
          },
        );

        response
          .set(
            'Cache-Control',
            'no-store',
          )
          .json({
            subtree: result,
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


  router.patch(
    '/admin/osm-boundaries',
    adminAuth.requireOsmEditor,
    audit(
      'data.osm-boundary.bulk-update',
    ),
    jsonBody,
    async (
      request,
      response,
      next,
    ) => {
      try {
        const result =
          await boundaryRepository
            .updateMany(
              request.body,
            );

        const derived =
          result.changedCount > 0
            ? await afterBoundaryChange?.()
            : undefined;

        if (
          result.changedCount > 0
        ) {
          realtimeEvents?.publish({
            resource:
              'osm-boundaries',
            action:
              'bulk-update',
            entityIds:
              result.entityIds,
            permission:
              'osm-editor',
            originClientId:
              realtimeClientId(
                request,
              ),
            message:
              'OSM-объекты изменены в другом сеансе.',
          });
        }

        recordAdminOperationDetails(
          response,
          {
            changedCount:
              result.changedCount,
            boundaryIds:
              result.entityIds,
          },
        );

        response
          .set(
            'Cache-Control',
            'no-store',
          )
          .json({
            ...result,
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

  router.patch(
    '/admin/osm-boundaries/:boundaryId',
    adminAuth.requireOsmEditor,
    audit(
      'data.osm-boundary.update',
    ),
    jsonBody,
    async (
      request,
      response,
      next,
    ) => {
      try {
        const previous =
          (
            await boundaryRepository
              .list()
          ).find(
            (item) =>
              String(item.id) ===
              String(
                request.params
                  .boundaryId,
              ),
          ) ?? null;

        const boundary =
          await boundaryRepository
            .update(
              request.params
                .boundaryId,
              request.body,
              {
                expectedUpdatedAt:
                  request.get?.(
                    'x-dtpstat-base-revision',
                  ) ?? null,
              },
            );

        if (!boundary) {
          response
            .status(404)
            .json({
              error:
                'OSM boundary not found',
            });
          return;
        }

        const derived =
          await afterBoundaryChange?.();

        realtimeEvents?.publish({
          resource:
            'osm-boundaries',
          action:
            'update',
          entityIds:
            [boundary.id],
          permission:
            'osm-editor',
          originClientId:
            realtimeClientId(
              request,
            ),
          message:
            'OSM-объект изменён в другом сеансе.',
        });

        recordAdminOperationChanges(
          response,
          previous,
          boundary,
        );

        response
          .set(
            'Cache-Control',
            'no-store',
          )
          .json({
            boundary,
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
}
