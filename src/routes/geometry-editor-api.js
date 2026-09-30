import {
  Router,
} from 'express';
import {
  jsonBody as createJsonBody,
} from '../http/admin-json-body.js';
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

function topologyError(
  response,
  error,
  operation,
) {
  if (
    validationError(
      response,
      error,
    )
  ) {
    return;
  }

  console.error(
    'Geometry topology operation failed',
    {
      operation,
      error,
    },
  );

  response
    .status(500)
    .json({
      error:
        'Запрошенная операция не выполнена',
    });
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

function editToken(
  request,
) {
  return (
    request.body
      ?.token ??
    request.get?.(
      'x-dtpstat-edit-token',
    ) ??
    null
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
 *     listUnlinkedGeometries: Function,
 *     listEditLeases: Function,
 *     listDiscussion: Function,
 *     postDiscussionMessage: Function,
 *     beginEdit: Function,
 *     heartbeatEdit: Function,
 *     validateEditTokens: Function,
 *     releaseEdit: Function,
 *     forceTakeover: Function,
 *     sync: Function,
 *     create: Function,
 *     update: Function,
 *     updateMany: Function,
 *     previewCut: Function,
 *     previewSplit: Function,
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
    createJsonBody(
      Math.min(
        maxBodyBytes,
        8 * 1024 * 1024,
      ),
      'application/json',
    );

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
    '/admin/geometry-editor/unlinked/geometries',
    adminAuth
      .requireGeometryEditor,
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
          .json(
            await geometryEditorService
              .listUnlinkedGeometries(),
          );
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    '/admin/geometry-editor/edit-locks',
    adminAuth
      .requireGeometryEditor,
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
            leases:
              await geometryEditorService
                .listEditLeases(),
          });
      } catch (error) {
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

  router.get(
    '/admin/geometry-editor/users/:userId/avatar',
    adminAuth
      .requireGeometryEditor,
    async (
      request,
      response,
      next,
    ) => {
      try {
        const userId =
          normalizeGeometryId(
            request.params.userId,
            'userId',
          );
        const avatar =
          await securityService
            .getAvatar(
              userId,
            );

        if (!avatar?.data) {
          response
            .status(404)
            .end();
          return;
        }

        response
          .set(
            'Cache-Control',
            'private, max-age=60',
          )
          .type(
            avatar.mime,
          )
          .send(
            avatar.data,
          );
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
    '/admin/geometry-editor/geometries/:geometryId/discussion',
    adminAuth
      .requireGeometryEditor,
    async (
      request,
      response,
      next,
    ) => {
      try {
        const discussion =
          await geometryEditorService
            .listDiscussion(
              request.params
                .geometryId,
            );

        if (!discussion) {
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
          .json(
            discussion,
          );
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
    '/admin/geometry-editor/geometries/:geometryId/discussion',
    adminAuth
      .requireGeometryEditor,
    audit(
      'geometry.discussion.message',
    ),
    jsonBody,
    async (
      request,
      response,
      next,
    ) => {
      try {
        const discussionMessage =
          await geometryEditorService
            .postDiscussionMessage(
              request.params
                .geometryId,
              request.adminUser,
              request.body,
            );

        if (!discussionMessage) {
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
              discussionMessage
                .geometryId,
            messageId:
              discussionMessage.id,
          },
        );

        realtimeEvents?.publish({
          resource:
            'geometry-discussions',
          permission:
            'geometry-editor',
          originClientId:
            realtimeClientId(
              request,
            ),
          action:
            'message-created',
          entityIds: [
            discussionMessage
              .geometryId,
          ],
          geometryId:
            discussionMessage
              .geometryId,
          discussionMessage,
          message:
            'Новое сообщение в обсуждении геометрии.',
        });

        response
          .status(201)
          .set(
            'Cache-Control',
            'no-store',
          )
          .json({
            message:
              discussionMessage,
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
    '/admin/geometry-editor/geometries/:geometryId/edit-lock',
    adminAuth
      .requireGeometryEditor,
    audit(
      'geometry.edit-lock.acquire',
    ),
    async (
      request,
      response,
      next,
    ) => {
      try {
        const lease =
          await geometryEditorService
            .beginEdit(
              request.params
                .geometryId,
              request.adminUser,
              realtimeClientId(
                request,
              ),
            );

        if (!lease) {
          response
            .status(404)
            .json({
              error:
                'Geometry not found',
            });
          return;
        }

        realtimeEvents?.publish({
          resource:
            'geometry-edit-leases',
          permission:
            'geometry-editor',
          originClientId:
            realtimeClientId(
              request,
            ),
          action:
            'acquired',
          entityIds:
            [lease.geometryId],
          lease: {
            ...lease,
            token:
              undefined,
          },
          message:
            'Редактирование геометрии начато.',
        });

        response
          .status(201)
          .set(
            'Cache-Control',
            'no-store',
          )
          .json({
            lease,
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
    '/admin/geometry-editor/geometries/:geometryId/edit-lock/heartbeat',
    adminAuth
      .requireGeometryEditor,
    jsonBody,
    async (
      request,
      response,
      next,
    ) => {
      try {
        const lease =
          await geometryEditorService
            .heartbeatEdit(
              request.params
                .geometryId,
              editToken(
                request,
              ),
              request.adminUser,
              realtimeClientId(
                request,
              ),
            );

        response
          .set(
            'Cache-Control',
            'no-store',
          )
          .json({
            lease,
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
    '/admin/geometry-editor/edit-locks/validate',
    adminAuth
      .requireGeometryEditor,
    jsonBody,
    async (
      request,
      response,
      next,
    ) => {
      try {
        response
          .set(
            'Cache-Control',
            'no-store',
          )
          .json(
            await geometryEditorService
              .validateEditTokens(
                request.body,
                request.adminUser,
                realtimeClientId(
                  request,
                ),
              ),
          );
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
    '/admin/geometry-editor/geometries/:geometryId/edit-lock/release',
    adminAuth
      .requireGeometryEditor,
    audit(
      'geometry.edit-lock.release',
    ),
    jsonBody,
    async (
      request,
      response,
      next,
    ) => {
      try {
        const released =
          await geometryEditorService
            .releaseEdit(
              request.params
                .geometryId,
              editToken(
                request,
              ),
              request.adminUser,
            );

        if (released) {
          realtimeEvents?.publish({
            resource:
              'geometry-edit-leases',
            permission:
              'geometry-editor',
            originClientId:
              realtimeClientId(
                request,
              ),
            action:
              'released',
            entityIds: [
              Number(
                request.params
                  .geometryId,
              ),
            ],
            message:
              'Редактирование геометрии завершено.',
          });
        }

        response
          .set(
            'Cache-Control',
            'no-store',
          )
          .json({
            released,
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
    '/admin/geometry-editor/geometries/:geometryId/edit-lock/takeover',
    adminAuth
      .requireSuperuser,
    audit(
      'geometry.edit-lock.takeover',
    ),
    async (
      request,
      response,
      next,
    ) => {
      try {
        const result =
          await geometryEditorService
            .forceTakeover(
              request.params
                .geometryId,
              request.adminUser,
              realtimeClientId(
                request,
              ),
            );

        if (!result) {
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
              result.lease
                .geometryId,
            previousUserId:
              result.previous
                ?.userId ??
              null,
            previousUsername:
              result.previous
                ?.username ??
              null,
          },
        );

        realtimeEvents?.publish({
          resource:
            'geometry-edit-leases',
          permission:
            'geometry-editor',
          originClientId:
            realtimeClientId(
              request,
            ),
          action:
            'force-takeover',
          entityIds:
            [result.lease.geometryId],
          revokedUserId:
            result.previous
              ?.userId ??
            null,
          revokedClientId:
            result.previous
              ?.clientId ??
            null,
          lease: {
            ...result.lease,
            token:
              undefined,
          },
          message:
            'Суперадминистратор принудительно перехватил редактирование геометрии.',
        });

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
    '/admin/geometry-editor/sync',
    adminAuth
      .requireGeometryEditor,
    audit(
      'geometry.bulk-sync',
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
            .sync(
              request.body,
              request.adminUser,
            );

        recordAdminOperationDetails(
          response,
          {
            createdCount:
              result.createdCount,
            updatedCount:
              result.updatedCount,
            deletedCount:
              result.deletedCount,
            geometryIds:
              result.entityIds,
          },
        );

        publishChange(
          realtimeEvents,
          request,
          {
            action:
              'bulk-sync',
            entityIds:
              result.entityIds,
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
                editToken:
                  editToken(
                    request,
                  ),
              },
              request.adminUser,
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
    '/admin/geometry-editor/topology/union-preview',
    adminAuth
      .requireGeometryEditor,
    audit(
      'geometry.union.preview',
    ),
    jsonBody,
    async (
      request,
      response,
    ) => {
      try {
        const geometry =
          await geometryEditorService
            .previewUnion(
              request.body,
            );

        recordAdminOperationDetails(
          response,
          {
            resultType:
              geometry.type,
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
        topologyError(
          response,
          error,
          'union-preview',
        );
      }
    },
  );

  router.post(
    '/admin/geometry-editor/topology/cut-preview',
    adminAuth
      .requireGeometryEditor,
    audit(
      'geometry.cut.preview',
    ),
    jsonBody,
    async (
      request,
      response,
    ) => {
      try {
        const geometry =
          await geometryEditorService
            .previewCut(
              request.body,
            );

        recordAdminOperationDetails(
          response,
          {
            resultType:
              geometry.type,
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
        topologyError(
          response,
          error,
          'cut-preview',
        );
      }
    },
  );

  router.post(
    '/admin/geometry-editor/topology/split-preview',
    adminAuth
      .requireGeometryEditor,
    audit(
      'geometry.split.preview',
    ),
    jsonBody,
    async (
      request,
      response,
    ) => {
      try {
        const geometries =
          await geometryEditorService
            .previewSplit(
              request.body,
            );

        recordAdminOperationDetails(
          response,
          {
            resultCount:
              geometries.length,
          },
        );

        response
          .set(
            'Cache-Control',
            'no-store',
          )
          .json({
            geometries,
          });
      } catch (error) {
        topologyError(
          response,
          error,
          'split-preview',
        );
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
