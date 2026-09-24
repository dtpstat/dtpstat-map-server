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

export function registerOsmBoundaryRoutes(
  router,
  {
    boundaryRepository,
    adminAuth,
    securityService,
    jsonBody,
    afterBoundaryChange,
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
          error instanceof
          OsmBoundaryAdminValidationError
        ) {
          response
            .status(
              error.statusCode,
            )
            .json({
              error: error.message,
            });
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
          error instanceof
          OsmBoundaryAdminValidationError
        ) {
          response
            .status(
              error.statusCode,
            )
            .json({
              error: error.message,
            });
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
          error instanceof
          OsmBoundaryAdminValidationError
        ) {
          response
            .status(
              error.statusCode,
            )
            .json({
              error: error.message,
            });
          return;
        }

        next(error);
      }
    },
  );
}
