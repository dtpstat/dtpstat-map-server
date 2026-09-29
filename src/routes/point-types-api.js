import express, {
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
import {
  POINT_TYPE_ICON_MAX_BYTES,
  PointTypeIconValidationError,
  pointTypeIconFileName,
  sanitizePointTypeIcon,
} from '../modules/points/type-icon.js';

function validation(
  response,
  error,
) {
  if (
    !(
      error instanceof
        PointTypeValidationError ||
      error instanceof
        PointTypeIconValidationError
    )
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

function publicPointType(
  pointType,
) {
  if (!pointType) {
    return null;
  }

  const publicValue = {
    ...pointType,
  };
  const iconSha256 =
    publicValue.iconSha256;

  delete publicValue
    .iconFileName;
  delete publicValue
    .iconSha256;

  return {
    ...publicValue,
    iconUrl:
      pointType.iconConfigured &&
      iconSha256
        ? (
            '/api/point-types/' +
            pointType.id +
            '/icon?v=' +
            encodeURIComponent(
              iconSha256,
            )
          )
        : null,
  };
}

function iconAuditValue(
  pointType,
) {
  return pointType?.iconConfigured
    ? {
        configured: true,
        mime:
          pointType.iconMime ??
          null,
        width:
          pointType.iconSourceWidth ??
          null,
        height:
          pointType.iconSourceHeight ??
          null,
      }
    : {
        configured: false,
      };
}

async function cleanupIcon(
  pointTypeIconStore,
  fileName,
) {
  if (
    !pointTypeIconStore ||
    !fileName
  ) {
    return false;
  }

  try {
    await pointTypeIconStore
      .remove(fileName);
    return false;
  } catch {
    return true;
  }
}

export function createPointTypesRouter({
  pointTypesRepository,
  pointTypeIconStore,
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

  const iconBody =
    express.raw({
      limit:
        POINT_TYPE_ICON_MAX_BYTES,
      inflate: false,
      type: [
        'image/png',
        'image/gif',
        'image/svg+xml',
        'application/octet-stream',
      ],
    });

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
              (
                await pointTypesRepository
                  .list()
              ).map(
                publicPointType,
              ),
          });
      } catch (error) {
        next(error);
      }
    },
  );

  if (pointTypeIconStore) {
    router.get(
      '/point-types/:pointTypeId/icon',
      async (
        request,
        response,
        next,
      ) => {
        try {
          const pointType =
            await pointTypesRepository
              .get(
                request.params
                  .pointTypeId,
              );

          if (
            !pointType ||
            !pointType.iconFileName ||
            !pointType.iconMime
          ) {
            response
              .status(404)
              .json({
                error:
                  'Point type icon not found',
              });
            return;
          }

          let data;
          try {
            data =
              await pointTypeIconStore
                .read(
                  pointType
                    .iconFileName,
                );
          } catch (error) {
            if (
              error?.code ===
              'ENOENT'
            ) {
              response
                .status(503)
                .json({
                  error:
                    'Point type icon file is unavailable',
                });
              return;
            }
            throw error;
          }

          const requestedVersion =
            String(
              request.query?.v ??
              '',
            );

          response
            .type(
              pointType.iconMime,
            )
            .set(
              'X-Content-Type-Options',
              'nosniff',
            )
            .set(
              'Content-Security-Policy',
              "default-src 'none'; style-src 'unsafe-inline'",
            )
            .set(
              'Cache-Control',
              requestedVersion &&
              requestedVersion ===
                pointType.iconSha256
                ? 'public, max-age=31536000, immutable'
                : 'no-cache',
            )
            .send(data);
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

    router.put(
      '/admin/point-types/:pointTypeId/icon',
      adminAuth.requireInterface,
      createAdminOperationAudit(
        securityService,
        'interface.point-types.icon.update',
      ),
      iconBody,
      async (
        request,
        response,
        next,
      ) => {
        let stored = null;

        try {
          const before =
            await pointTypesRepository
              .get(
                request.params
                  .pointTypeId,
              );

          if (!before) {
            response
              .status(404)
              .json({
                error:
                  'Point type not found',
              });
            return;
          }

          const icon =
            sanitizePointTypeIcon(
              request.body,
              request.get(
                'content-type',
              ),
            );

          stored =
            await pointTypeIconStore
              .save(
                pointTypeIconFileName(
                  before.id,
                  icon,
                ),
                icon.data,
              );

          let saved;
          try {
            saved =
              await pointTypesRepository
                .saveIconMetadata(
                  before.id,
                  {
                    fileName:
                      stored.fileName,
                    mime:
                      icon.mime,
                    width:
                      icon.width,
                    height:
                      icon.height,
                    sha256:
                      icon.sha256,
                  },
                );
          } catch (error) {
            await cleanupIcon(
              pointTypeIconStore,
              stored.fileName,
            );
            throw error;
          }

          if (!saved) {
            await cleanupIcon(
              pointTypeIconStore,
              stored.fileName,
            );
            response
              .status(404)
              .json({
                error:
                  'Point type not found',
              });
            return;
          }

          const cleanupPending =
            saved
              .previousIconFileName &&
            saved
              .previousIconFileName !==
              stored.fileName
              ? await cleanupIcon(
                pointTypeIconStore,
                saved
                  .previousIconFileName,
              )
              : false;

          recordAdminOperationChanges(
            response,
            {
              pointTypeIcon:
                iconAuditValue(
                  before,
                ),
            },
            {
              pointTypeIcon:
                iconAuditValue(
                  saved.pointType,
                ),
            },
          );

          recordAdminOperationDetails(
            response,
            {
              pointTypeId:
                before.id,
              iconSha256:
                icon.sha256,
              cleanupPending,
            },
          );

          response
            .set(
              'Cache-Control',
              'no-store',
            )
            .json({
              pointType:
                publicPointType(
                  saved.pointType,
                ),
              cleanupPending,
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
      '/admin/point-types/:pointTypeId/icon',
      adminAuth.requireInterface,
      createAdminOperationAudit(
        securityService,
        'interface.point-types.icon.reset',
      ),
      async (
        request,
        response,
        next,
      ) => {
        try {
          const before =
            await pointTypesRepository
              .get(
                request.params
                  .pointTypeId,
              );

          if (!before) {
            response
              .status(404)
              .json({
                error:
                  'Point type not found',
              });
            return;
          }

          const cleared =
            await pointTypesRepository
              .clearIconMetadata(
                before.id,
              );

          if (!cleared) {
            response
              .status(404)
              .json({
                error:
                  'Point type not found',
              });
            return;
          }

          const cleanupPending =
            await cleanupIcon(
              pointTypeIconStore,
              cleared
                .previousIconFileName,
            );

          recordAdminOperationChanges(
            response,
            {
              pointTypeIcon:
                iconAuditValue(
                  before,
                ),
            },
            {
              pointTypeIcon:
                iconAuditValue(
                  cleared.pointType,
                ),
            },
          );

          recordAdminOperationDetails(
            response,
            {
              pointTypeId:
                before.id,
              cleanupPending,
            },
          );

          response
            .set(
              'Cache-Control',
              'no-store',
            )
            .json({
              pointType:
                publicPointType(
                  cleared.pointType,
                ),
              cleanupPending,
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
  }

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
            pointType:
              publicPointType(
                pointType,
              ),
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
            pointType:
              publicPointType(
                pointType,
              ),
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
        const cleanupPending =
          await cleanupIcon(
            pointTypeIconStore,
            deleted.iconFileName,
          );

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
            cleanupPending,
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
