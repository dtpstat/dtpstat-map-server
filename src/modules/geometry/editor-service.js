import {
  GeometryEditorValidationError,
  geometryFamily,
  normalizeGeometryBulkUpdates,
  normalizeGeometryChanges,
  normalizeGeometryEditToken,
  normalizeGeometryEditTokenValidation,
  normalizeGeometryEditorClientId,
  normalizeGeometryCreatePayload,
  normalizeGeometryDiscussionMessage,
  normalizeGeometryId,
  normalizeGeometryRevision,
  normalizeGeometrySyncRequest,
  validateGeometryLineState,
  validateGeometryDisplayWindow,
} from './editor-policy.js';
import {
  normalizeGeometryCutPreviewRequest,
  normalizeGeometrySplitPreviewRequest,
  normalizeGeometryUnionPreviewRequest,
} from './topology-policy.js';

function own(
  value,
  key,
) {
  return Object.hasOwn(
    value,
    key,
  );
}

function revision(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return normalizeGeometryRevision(
    String(value),
  );
}

function databaseGeometryError(
  error,
) {
  const message =
    String(
      error?.message ??
      '',
    );

  return (
    error?.code === '23514' ||
    error?.code === '22P02' ||
    error?.code === 'XX000' ||
    /geometry|GeoJSON|TopologyException|latitude|longitude/iu
      .test(message)
  );
}

async function rollbackQuietly(
  client,
) {
  try {
    await client.query(
      'ROLLBACK',
    );
  } catch {
    // Preserve the original error.
  }
}

function nextGeometryValue(
  previous,
  changes,
) {
  const geometry =
    own(changes, 'geometry')
      ? changes.geometry
      : previous.geometry;

  const family =
    geometryFamily(
      geometry,
    );

  let lineTypeId = null;
  let pointTypeId = null;
  let lanes = null;

  if (family === 'line') {
    lineTypeId =
      own(
        changes,
        'lineTypeId',
      )
        ? changes.lineTypeId
        : previous.lineTypeId;

    lanes =
      own(
        changes,
        'lanes',
      )
        ? changes.lanes
        : previous.lanes;

    if (
      own(
        changes,
        'pointTypeId',
      ) &&
      changes.pointTypeId !== null
    ) {
      pointTypeId =
        changes.pointTypeId;
    }
  } else if (
    family === 'point'
  ) {
    pointTypeId =
      own(
        changes,
        'pointTypeId',
      )
        ? changes.pointTypeId
        : (
            previous.pointTypeId ??
            null
          );

    if (
      own(
        changes,
        'lineTypeId',
      ) &&
      changes.lineTypeId !== null
    ) {
      lineTypeId =
        changes.lineTypeId;
    }
    if (
      own(
        changes,
        'lanes',
      ) &&
      changes.lanes !== null
    ) {
      lanes =
        changes.lanes;
    }
  } else {
    if (
      own(
        changes,
        'lineTypeId',
      ) &&
      changes.lineTypeId !== null
    ) {
      lineTypeId =
        changes.lineTypeId;
    }
    if (
      own(
        changes,
        'pointTypeId',
      ) &&
      changes.pointTypeId !== null
    ) {
      pointTypeId =
        changes.pointTypeId;
    }
    if (
      own(
        changes,
        'lanes',
      ) &&
      changes.lanes !== null
    ) {
      lanes =
        changes.lanes;
    }
  }

  validateGeometryLineState(
    geometry,
    lineTypeId,
    lanes,
    pointTypeId,
  );

  const minZoom =
    own(changes, 'minZoom')
      ? changes.minZoom
      : (previous.minZoom ?? null);
  const maxZoom =
    own(changes, 'maxZoom')
      ? changes.maxZoom
      : (previous.maxZoom ?? null);
  const validFrom =
    own(changes, 'validFrom')
      ? changes.validFrom
      : (previous.validFrom ?? null);
  const validTo =
    own(changes, 'validTo')
      ? changes.validTo
      : (previous.validTo ?? null);

  validateGeometryDisplayWindow(
    minZoom,
    maxZoom,
    validFrom,
    validTo,
  );

  return {
    geometry,
    family,
    displayName:
      own(
        changes,
        'displayName',
      )
        ? changes.displayName
        : previous.displayName,
    tooltip:
      own(
        changes,
        'tooltip',
      )
        ? changes.tooltip
        : previous.tooltip,
    tags:
      own(
        changes,
        'tags',
      )
        ? changes.tags
        : previous.tags,
    isVisible:
      own(
        changes,
        'isVisible',
      )
        ? changes.isVisible
        : previous.isVisible,
    lineTypeId,
    pointTypeId,
    lanes,
    minZoom,
    maxZoom,
    validFrom,
    validTo,
  };
}

function conflictDetails(
  updates,
  locked,
) {
  const byId =
    new Map(
      locked.map(
        (item) => [
          item.id,
          item,
        ],
      ),
    );

  const conflicts = [];

  for (
    const update of updates
  ) {
    const item =
      byId.get(
        update.id,
      );

    if (!item) {
      conflicts.push({
        id:
          update.id,
        reason:
          'missing',
        expectedUpdatedAt:
          update.baseUpdatedAt,
        actualUpdatedAt:
          null,
      });
      continue;
    }

    const actual =
      revision(
        item.updatedAt,
      );

    if (
      actual !==
      update.baseUpdatedAt
    ) {
      conflicts.push({
        id:
          update.id,
        reason:
          'changed',
        expectedUpdatedAt:
          update.baseUpdatedAt,
        actualUpdatedAt:
          actual,
      });
    }
  }

  return conflicts;
}

/**
 * Geometry editor use case.
 *
 * @param {{ connect: () => Promise<any> }} pool
 * @param {{
 *   storage: any,
 *   leaseStorage: any,
 *   discussionStorage: any,
 *   acquireLock: (client: any, pool: any) => Promise<void>,
 *   randomUUID: () => string,
 *   leaseSeconds?: number
 * }} dependencies
 */
export function createGeometryEditorService(
  pool,
  dependencies,
) {
  const storage =
    dependencies?.storage;
  const acquireLock =
    dependencies?.acquireLock;
  const leaseStorage =
    dependencies?.leaseStorage;
  const discussionStorage =
    dependencies?.discussionStorage;
  const randomUUID =
    dependencies?.randomUUID;
  const leaseSeconds =
    Number(
      dependencies?.leaseSeconds ??
      90,
    );

  if (!storage) {
    throw new TypeError(
      'Geometry editor storage dependency is required',
    );
  }
  if (!leaseStorage) {
    throw new TypeError(
      'Geometry edit lease storage dependency is required',
    );
  }
  if (!discussionStorage) {
    throw new TypeError(
      'Geometry discussion storage dependency is required',
    );
  }
  if (
    typeof randomUUID !==
    'function'
  ) {
    throw new TypeError(
      'Geometry editor randomUUID dependency is required',
    );
  }
  if (
    !Number.isInteger(leaseSeconds) ||
    leaseSeconds < 30 ||
    leaseSeconds > 600
  ) {
    throw new TypeError(
      'Geometry editor leaseSeconds must be 30-600',
    );
  }
  if (
    typeof acquireLock !==
    'function'
  ) {
    throw new TypeError(
      'Geometry editor acquireLock dependency is required',
    );
  }

  async function write(
    operation,
  ) {
    const client =
      await pool.connect();

    try {
      await client.query(
        'BEGIN',
      );
      await acquireLock(
        client,
        pool,
      );
      await storage
        .assertNoPendingImport(
          client,
        );

      const result =
        await operation(
          client,
        );

      await storage
        .assertInvariants(
          client,
        );

      await client.query(
        'COMMIT',
      );

      return result;
    } catch (error) {
      await rollbackQuietly(
        client,
      );

      if (
        error instanceof
        GeometryEditorValidationError
      ) {
        throw error;
      }

      if (
        error?.code ===
        '55000'
      ) {
        throw new GeometryEditorValidationError(
          error.message,
          409,
        );
      }

      if (
        databaseGeometryError(
          error,
        )
      ) {
        throw new GeometryEditorValidationError(
          `Invalid geometry: ${error.message}`,
        );
      }

      throw error;
    } finally {
      client.release();
    }
  }

  async function preview(
    operation,
  ) {
    const client =
      await pool.connect();

    try {
      return await operation(
        client,
      );
    } catch (error) {
      if (
        error instanceof
        GeometryEditorValidationError
      ) {
        throw error;
      }

      if (
        databaseGeometryError(
          error,
        )
      ) {
        throw new GeometryEditorValidationError(
          `Invalid geometry: ${error.message}`,
        );
      }

      throw error;
    } finally {
      client.release();
    }
  }

  async function leaseTransaction(
    operation,
  ) {
    const client =
      await pool.connect();

    try {
      await client.query(
        'BEGIN',
      );
      const result =
        await operation(
          client,
        );
      await client.query(
        'COMMIT',
      );
      return result;
    } catch (error) {
      await rollbackQuietly(
        client,
      );
      throw error;
    } finally {
      client.release();
    }
  }

  function actorId(actor) {
    return normalizeGeometryId(
      actor?.id,
      'userId',
    );
  }

  function publicLease(
    lease,
    includeToken = false,
  ) {
    if (!lease) return null;
    return {
      geometryId:
        lease.geometryId,
      userId:
        lease.userId,
      username:
        lease.username,
      displayName:
        lease.displayName ??
        lease.username ??
        null,
      avatarUrl:
        lease.hasAvatar &&
        lease.userId
          ? '/api/admin/geometry-editor/users/' +
            lease.userId +
            '/avatar'
          : null,
      clientId:
        lease.clientId,
      generation:
        lease.generation,
      acquiredAt:
        lease.acquiredAt,
      lastSeenAt:
        lease.lastSeenAt,
      expiresAt:
        lease.expiresAt,
      ...(includeToken
        ? {
          token:
            lease.token,
        }
        : {}),
    };
  }

  function publicDiscussionMessage(
    message,
  ) {
    if (!message) return null;

    return {
      id:
        message.id,
      geometryId:
        message.geometryId,
      geometryRevision:
        message.geometryRevision,
      message:
        message.message,
      createdAt:
        message.createdAt,
      editedAt:
        message.editedAt,
      deliveredAt:
        message.createdAt,
      readByOthersCount:
        Number(
          message.readByOthersCount ??
          0,
        ),
      author: {
        userId:
          message.authorUserId,
        username:
          message.authorUsername,
        displayName:
          message.authorDisplayName ??
          message.authorUsername ??
          'Удалённый пользователь',
        avatarUrl:
          message.authorHasAvatar &&
          message.authorUserId
            ? '/api/admin/geometry-editor/users/' +
              message.authorUserId +
              '/avatar'
            : null,
      },
    };
  }

  async function requireOwnedEditLease(
    client,
    {
      geometryId,
      token,
      userId,
    },
  ) {
    const ownsLease =
      await leaseStorage
        .owns(
          client,
          {
            geometryId,
            token,
            userId,
          },
        );

    if (ownsLease) {
      return;
    }

    throw new GeometryEditorValidationError(
      'Edit token is no longer valid',
      409,
      {
        conflicts: [{
          id:
            geometryId,
          reason:
            'edit-lock',
          lease:
            publicLease(
              await leaseStorage
                .active(
                  client,
                  geometryId,
                ),
            ),
        }],
      },
    );
  }

  async function ensureActiveBoundaryCities() {
    const initial =
      await storage
        .boundaryLinkState();

    if (
      Number(
        initial
          .unlinkedBoundaries ??
        0,
      ) === 0
    ) {
      return initial;
    }

    const client =
      await pool.connect();

    try {
      await client.query(
        'BEGIN',
      );
      await acquireLock(
        client,
        pool,
      );

      const locked =
        await storage
          .boundaryLinkState(
            client,
          );

      if (
        Number(
          locked
            .unlinkedBoundaries ??
          0,
        ) > 0
      ) {
        await storage
          .syncActiveBoundaryCities(
            client,
          );
        await storage
          .relinkAllGeometries(
            client,
          );
      }

      await client.query(
        'COMMIT',
      );
    } catch (error) {
      await rollbackQuietly(
        client,
      );
      throw error;
    } finally {
      client.release();
    }

    return storage
      .boundaryLinkState();
  }

  async function assertLineType(
    client,
    value,
  ) {
    if (
      value.lineTypeId ===
      null
    ) {
      return;
    }

    if (
      !await storage
        .lineTypeExists(
          client,
          value.lineTypeId,
        )
    ) {
      throw new GeometryEditorValidationError(
        'lineTypeId does not exist',
      );
    }
  }

  async function assertPointType(
    client,
    value,
  ) {
    if (
      value.pointTypeId ===
        null ||
      value.pointTypeId ===
        undefined
    ) {
      return;
    }

    if (
      !await storage
        .pointTypeExists(
          client,
          value.pointTypeId,
        )
    ) {
      throw new GeometryEditorValidationError(
        'pointTypeId does not exist',
      );
    }
  }

  async function assertGeometryTypes(
    client,
    value,
  ) {
    await assertLineType(
      client,
      value,
    );
    await assertPointType(
      client,
      value,
    );
  }

  async function updateLocked(
    client,
    previous,
    changes,
  ) {
    const next =
      nextGeometryValue(
        previous,
        changes,
      );

    await assertGeometryTypes(
      client,
      next,
    );

    const result =
      await storage
        .updateGeometry(
          client,
          previous.id,
          next,
        );

    if (!result) {
      throw new GeometryEditorValidationError(
        'Geometry must be non-empty and valid',
      );
    }

    await storage
      .relinkGeometry(
        client,
        previous.id,
      );

    return storage
      .getGeometry(
        client,
        previous.id,
      );
  }

  return {
    async listCities() {
      const linkState =
        await ensureActiveBoundaryCities();

      return {
        cities:
          await storage
            .listCities(),
        linkState,
      };
    },

    async listUnlinkedGeometries() {
      return {
        city: null,
        geometries:
          await storage
            .listUnlinkedGeometries(),
      };
    },

    async listCityGeometries(
      cityId,
    ) {
      const id =
        normalizeGeometryId(
          cityId,
          'cityId',
        );

      await ensureActiveBoundaryCities();

      const [
        city,
        geometries,
      ] =
        await Promise.all([
          storage.getCity(id),
          storage
            .listCityGeometries(
              id,
            ),
        ]);

      return city
        ? {
          city,
          geometries,
        }
        : null;
    },

    get(geometryId) {
      return storage
        .getGeometry(
          pool,
          normalizeGeometryId(
            geometryId,
          ),
        );
    },

    async create(payload) {
      const normalized =
        normalizeGeometryCreatePayload(
          payload,
        );

      return write(
        async (client) => {
          await assertGeometryTypes(
            client,
            normalized,
          );

          const geometry =
            await storage
              .createGeometry(
                client,
                normalized,
              );

          if (!geometry) {
            throw new GeometryEditorValidationError(
              'Geometry must be non-empty and valid',
            );
          }

          await storage
            .relinkGeometry(
              client,
              geometry.id,
            );

          return storage
            .getGeometry(
              client,
              geometry.id,
            );
        },
      );
    },

    async update(
      geometryId,
      changes,
      options = {},
    ) {
      const id =
        normalizeGeometryId(
          geometryId,
        );
      const normalized =
        normalizeGeometryChanges(
          changes,
        );
      const expected =
        options
          .expectedUpdatedAt ===
          undefined ||
        options
          .expectedUpdatedAt ===
          null ||
        options
          .expectedUpdatedAt ===
          ''
          ? null
          : normalizeGeometryRevision(
            options
              .expectedUpdatedAt,
          );

      return write(
        async (client) => {
          const locked =
            await storage
              .lockGeometries(
                client,
                [id],
              );

          const previous =
            locked[0] ??
            null;

          if (!previous) {
            return null;
          }

          if (
            expected &&
            revision(
              previous.updatedAt,
            ) !== expected
          ) {
            throw new GeometryEditorValidationError(
              'Geometry changed after the local draft was created',
              409,
              {
                conflicts: [{
                  id,
                  reason:
                    'changed',
                  expectedUpdatedAt:
                    expected,
                  actualUpdatedAt:
                    revision(
                      previous
                        .updatedAt,
                    ),
                }],
              },
            );
          }

          return updateLocked(
            client,
            previous,
            normalized,
          );
        },
      );
    },

    async updateMany(payload) {
      const updates =
        normalizeGeometryBulkUpdates(
          payload,
        );

      return write(
        async (client) => {
          const ids =
            updates
              .map(
                (item) =>
                  item.id,
              )
              .sort(
                (
                  left,
                  right,
                ) =>
                  left - right,
              );

          const locked =
            await storage
              .lockGeometries(
                client,
                ids,
              );

          const conflicts =
            conflictDetails(
              updates,
              locked,
            );

          if (
            conflicts.length > 0
          ) {
            throw new GeometryEditorValidationError(
              'One or more geometries changed after the local drafts were created',
              409,
              {
                conflicts,
              },
            );
          }

          const byId =
            new Map(
              locked.map(
                (item) => [
                  item.id,
                  item,
                ],
              ),
            );

          const geometries = [];

          for (
            const update of updates
          ) {
            geometries.push(
              await updateLocked(
                client,
                byId.get(
                  update.id,
                ),
                update.changes,
              ),
            );
          }

          return {
            changedCount:
              geometries.length,
            entityIds:
              geometries.map(
                (geometry) =>
                  geometry.id,
              ),
            geometries,
          };
        },
      );
    },

    async previewUnion(
      payload,
    ) {
      const {
        geometries,
        family,
      } =
        normalizeGeometryUnionPreviewRequest(
          payload,
        );

      const geometry =
        await preview(
          (client) =>
            storage.previewUnion(
              client,
              geometries,
              family,
            ),
        );

      if (!geometry) {
        throw new GeometryEditorValidationError(
          'Union must produce a valid non-empty geometry',
        );
      }

      return geometry;
    },

    async previewCut(
      payload,
    ) {
      const {
        sourceGeometry,
        cutterGeometry,
      } =
        normalizeGeometryCutPreviewRequest(
          payload,
        );

      const geometry =
        await preview(
          (client) =>
            storage.previewCut(
              client,
              sourceGeometry,
              cutterGeometry,
            ),
        );

      if (!geometry) {
        throw new GeometryEditorValidationError(
          'Cut must overlap only part of the polygon and produce a valid non-empty result',
        );
      }

      return geometry;
    },

    async previewSplit(
      payload,
    ) {
      const {
        sourceGeometry,
        blade,
        family,
      } =
        normalizeGeometrySplitPreviewRequest(
          payload,
        );

      const geometries =
        await preview(
          (client) =>
            storage.previewSplit(
              client,
              sourceGeometry,
              blade,
              family,
            ),
        );

      if (
        !Array.isArray(
          geometries,
        ) ||
        geometries.length < 2
      ) {
        throw new GeometryEditorValidationError(
          'Split blade must actually divide the geometry into valid parts',
        );
      }

      return geometries;
    },

    async delete(
      geometryId,
      options = {},
      actor,
    ) {
      const id =
        normalizeGeometryId(
          geometryId,
        );
      const token =
        normalizeGeometryEditToken(
          options.editToken,
        );
      const userId =
        actorId(actor);
      const expected =
        options
          .expectedUpdatedAt ===
          undefined ||
        options
          .expectedUpdatedAt ===
          null ||
        options
          .expectedUpdatedAt ===
          ''
          ? null
          : normalizeGeometryRevision(
            options
              .expectedUpdatedAt,
          );

      return write(
        async (client) => {
          const locked =
            await storage
              .lockGeometries(
                client,
                [id],
              );

          const previous =
            locked[0] ??
            null;

          if (!previous) {
            return null;
          }

          if (
            expected &&
            revision(
              previous.updatedAt,
            ) !== expected
          ) {
            throw new GeometryEditorValidationError(
              'Geometry changed before deletion',
              409,
              {
                conflicts: [{
                  id,
                  reason:
                    'changed',
                  expectedUpdatedAt:
                    expected,
                  actualUpdatedAt:
                    revision(
                      previous
                        .updatedAt,
                    ),
                }],
              },
            );
          }

          await requireOwnedEditLease(
            client,
            {
              geometryId:
                id,
              token,
              userId,
            },
          );

          await storage
            .deleteGeometry(
              client,
              id,
            );

          return previous;
        },
      );
    },

    async sync(
      payload,
      actor,
    ) {
      const items =
        normalizeGeometrySyncRequest(
          payload,
        );
      const userId =
        actorId(actor);

      return write(
        async (client) => {
          const updates =
            items.filter(
              (item) =>
                item.kind ===
                'update',
            );
          const deletes =
            items.filter(
              (item) =>
                item.kind ===
                'delete',
            );
          const persisted =
            [
              ...updates,
              ...deletes,
            ];
          const persistedIds =
            persisted
              .map(
                (item) =>
                  item.id,
              )
              .sort(
                (
                  left,
                  right,
                ) =>
                  left - right,
              );

          const locked =
            persistedIds.length > 0
              ? await storage
                .lockGeometries(
                  client,
                  persistedIds,
                )
              : [];

          const conflicts =
            conflictDetails(
              persisted,
              locked,
            );

          if (
            conflicts.length > 0
          ) {
            throw new GeometryEditorValidationError(
              'One or more geometries changed after the local drafts were created',
              409,
              {
                conflicts,
              },
            );
          }

          for (
            const item of persisted
          ) {
            const ownsLease =
              await leaseStorage
                .owns(
                  client,
                  {
                    geometryId:
                      item.id,
                    token:
                      item.editToken,
                    userId,
                  },
                );

            if (!ownsLease) {
              throw new GeometryEditorValidationError(
                'One or more edit tokens are no longer valid',
                409,
                {
                  conflicts: [{
                    id:
                      item.id,
                    reason:
                      'edit-lock',
                    lease:
                      publicLease(
                        await leaseStorage
                          .active(
                            client,
                            item.id,
                          ),
                      ),
                  }],
                },
              );
            }
          }

          const byId =
            new Map(
              locked.map(
                (item) => [
                  item.id,
                  item,
                ],
              ),
            );
          const updateIdSet =
            new Set(
              updates.map(
                (item) =>
                  item.id,
              ),
            );
          const creates =
            items.filter(
              (item) =>
                item.kind ===
                'create',
            );

          for (
            const item of creates
          ) {
            if (
              item.sourceGeometryId !==
                null &&
              !updateIdSet.has(
                item.sourceGeometryId,
              )
            ) {
              throw new GeometryEditorValidationError(
                'sourceGeometryId must reference an update in the same sync request',
              );
            }
          }

          const updated = [];

          for (
            const item of updates
          ) {
            updated.push(
              await updateLocked(
                client,
                byId.get(
                  item.id,
                ),
                item.changes,
              ),
            );
          }

          const updatedById =
            new Map(
              updated.map(
                (item) => [
                  item.id,
                  item,
                ],
              ),
            );
          const created = [];

          for (
            const item of creates
          ) {
            await assertGeometryTypes(
              client,
              item.value,
            );

            const source =
              item.sourceGeometryId ===
                null
                ? null
                : updatedById.get(
                  item.sourceGeometryId,
                );

            if (
              source &&
              source.family !==
                item.value.family
            ) {
              throw new GeometryEditorValidationError(
                'Cloned geometry must keep the source geometry family',
              );
            }

            const geometry =
              item.sourceGeometryId ===
                null
                ? await storage
                  .createGeometry(
                    client,
                    item.value,
                  )
                : await storage
                  .createGeometryFromSource(
                    client,
                    item.sourceGeometryId,
                    item.value,
                  );

            if (!geometry) {
              throw new GeometryEditorValidationError(
                'Geometry must be non-empty and valid',
              );
            }

            await storage
              .relinkGeometry(
                client,
                geometry.id,
              );

            created.push({
              localId:
                item.localId,
              geometry:
                await storage
                  .getGeometry(
                    client,
                    geometry.id,
                  ),
            });
          }

          const deleted = [];

          for (
            const item of deletes
          ) {
            const previous =
              byId.get(
                item.id,
              );

            await storage
              .deleteGeometry(
                client,
                item.id,
              );

            deleted.push(
              previous,
            );
          }

          const entityIds = [
            ...created.map(
              (item) =>
                item.geometry.id,
            ),
            ...updated.map(
              (item) =>
                item.id,
            ),
            ...deleted.map(
              (item) =>
                item.id,
            ),
          ];

          return {
            createdCount:
              created.length,
            updatedCount:
              updated.length,
            deletedCount:
              deleted.length,
            changedCount:
              entityIds.length,
            entityIds,
            created,
            updated,
            deleted,
          };
        },
      );
    },

    async listDiscussion(
      geometryId,
    ) {
      const id =
        normalizeGeometryId(
          geometryId,
        );

      if (
        !await discussionStorage
          .geometryExists(id)
      ) {
        return null;
      }

      return {
        geometryId: id,
        messages:
          (
            await discussionStorage
              .listMessages(id)
          ).map(
            publicDiscussionMessage,
          ),
      };
    },

    async listDiscussionUnread(
      actor,
    ) {
      const userId =
        actorId(actor);
      const rows =
        await discussionStorage
          .unreadCounts(
            userId,
          );

      return {
        items:
          rows.map(
            (row) => ({
              geometryId:
                row.geometryId,
              unreadCount:
                row.unreadCount,
            }),
          ),
      };
    },

    async listDiscussionState(
      actor,
    ) {
      const userId =
        actorId(actor);
      const rows =
        await discussionStorage
          .threadStates(
            userId,
          );

      return {
        items:
          rows.map(
            (row) => ({
              geometryId:
                row.geometryId,
              unreadCount:
                row.unreadCount,
              messageCount:
                row.messageCount,
            }),
          ),
      };
    },

    async markDiscussionRead(
      geometryId,
      actor,
      payload = {},
    ) {
      const id =
        normalizeGeometryId(
          geometryId,
        );
      const userId =
        actorId(actor);

      if (
        !await discussionStorage
          .geometryExists(id)
      ) {
        return null;
      }

      const messageId =
        payload?.messageId ===
          undefined ||
        payload?.messageId ===
          null
          ? await discussionStorage
            .latestMessageId(id)
          : normalizeGeometryId(
            payload.messageId,
            'messageId',
          );

      if (!messageId) {
        return {
          geometryId:
            id,
          userId,
          lastReadMessageId:
            null,
        };
      }

      return leaseTransaction(
        (client) =>
          discussionStorage
            .markRead(
              client,
              {
                geometryId:
                  id,
                userId,
                messageId,
              },
            ),
      );
    },

    async postDiscussionMessage(
      geometryId,
      actor,
      payload,
    ) {
      const id =
        normalizeGeometryId(
          geometryId,
        );
      const userId =
        actorId(actor);
      const normalized =
        normalizeGeometryDiscussionMessage(
          payload,
        );

      return leaseTransaction(
        async (client) =>
          publicDiscussionMessage(
            await discussionStorage
              .createMessage(
                client,
                {
                  geometryId:
                    id,
                  authorUserId:
                    userId,
                  message:
                    normalized.message,
                },
              ),
          ),
      );
    },

    async listEditLeases() {
      return (
        await leaseStorage
          .listActive()
      ).map(
        (lease) =>
          publicLease(
            lease,
          ),
      );
    },

    async beginEdit(
      geometryId,
      actor,
      clientIdValue,
    ) {
      const id =
        normalizeGeometryId(
          geometryId,
        );
      const userId =
        actorId(actor);
      const clientId =
        normalizeGeometryEditorClientId(
          clientIdValue,
        );
      const token =
        randomUUID();

      return leaseTransaction(
        async (client) => {
          const lease =
            await leaseStorage
              .acquire(
                client,
                {
                  geometryId:
                    id,
                  token,
                  userId,
                  clientId,
                  leaseSeconds,
                },
              );

          if (!lease) {
            return null;
          }

          if (
            lease.token !==
            token
          ) {
            throw new GeometryEditorValidationError(
              'Geometry is already being edited',
              409,
              {
                lease:
                  publicLease(
                    lease,
                  ),
              },
            );
          }

          return publicLease(
            lease,
            true,
          );
        },
      );
    },

    async heartbeatEdit(
      geometryId,
      tokenValue,
      actor,
      clientIdValue,
    ) {
      const id =
        normalizeGeometryId(
          geometryId,
        );
      const userId =
        actorId(actor);
      const token =
        normalizeGeometryEditToken(
          tokenValue,
        );
      const clientId =
        normalizeGeometryEditorClientId(
          clientIdValue,
        );

      return leaseTransaction(
        async (client) => {
          const lease =
            await leaseStorage
              .renew(
                client,
                {
                  geometryId:
                    id,
                  token,
                  userId,
                  clientId,
                  leaseSeconds,
                },
              );

          if (!lease) {
            throw new GeometryEditorValidationError(
              'Edit token is no longer valid',
              409,
              {
                lease:
                  publicLease(
                    await leaseStorage
                      .active(
                        client,
                        id,
                      ),
                  ),
              },
            );
          }

          return publicLease(
            lease,
            true,
          );
        },
      );
    },

    async validateEditTokens(
      payload,
      actor,
      clientIdValue,
    ) {
      const items =
        normalizeGeometryEditTokenValidation(
          payload,
        );
      const userId =
        actorId(actor);
      const clientId =
        normalizeGeometryEditorClientId(
          clientIdValue,
        );

      return leaseTransaction(
        async (client) => {
          const results = [];

          for (
            const item of items
          ) {
            const lease =
              await leaseStorage
                .renew(
                  client,
                  {
                    geometryId:
                      item.id,
                    token:
                      item.token,
                    userId,
                    clientId,
                    leaseSeconds,
                  },
                );

            if (lease) {
              results.push({
                id:
                  item.id,
                status:
                  'valid',
                lease:
                  publicLease(
                    lease,
                    true,
                  ),
              });
              continue;
            }

            const current =
              await leaseStorage
                .active(
                  client,
                  item.id,
                );
            const exists =
              await leaseStorage
                .geometryExists(
                  client,
                  item.id,
                );

            results.push({
              id:
                item.id,
              status:
                !exists
                  ? 'geometry-deleted'
                  : current
                    ? 'revoked'
                    : 'expired',
              lease:
                publicLease(
                  current,
                ),
            });
          }

          return {
            results,
          };
        },
      );
    },

    async releaseEdit(
      geometryId,
      tokenValue,
      actor,
    ) {
      const id =
        normalizeGeometryId(
          geometryId,
        );
      const userId =
        actorId(actor);
      const token =
        normalizeGeometryEditToken(
          tokenValue,
        );

      return leaseTransaction(
        (client) =>
          leaseStorage
            .release(
              client,
              {
                geometryId:
                  id,
                token,
                userId,
              },
            ),
      );
    },

    async forceTakeover(
      geometryId,
      actor,
      clientIdValue,
    ) {
      if (
        !actor?.isSuperuser
      ) {
        throw new GeometryEditorValidationError(
          'Superuser permission is required for forced edit takeover',
          403,
        );
      }

      const id =
        normalizeGeometryId(
          geometryId,
        );
      const userId =
        actorId(actor);
      const clientId =
        normalizeGeometryEditorClientId(
          clientIdValue,
        );
      const token =
        randomUUID();

      return leaseTransaction(
        async (client) => {
          const result =
            await leaseStorage
              .forceTakeover(
                client,
                {
                  geometryId:
                    id,
                  token,
                  userId,
                  clientId,
                  leaseSeconds,
                },
              );

          if (!result.lease) {
            return null;
          }

          return {
            previous:
              publicLease(
                result.previous,
              ),
            lease:
              publicLease(
                result.lease,
                true,
              ),
          };
        },
      );
    },

    async recalculate() {
      return write(
        (client) =>
          storage
            .recalculateDerived(
              client,
            ),
      );
    },
  };
}
