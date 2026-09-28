import {
  GeometryEditorValidationError,
  geometryFamily,
  normalizeGeometryBulkUpdates,
  normalizeGeometryChanges,
  normalizeGeometryEditToken,
  normalizeGeometryEditTokenValidation,
  normalizeGeometryEditorClientId,
  normalizeGeometryCreatePayload,
  normalizeGeometryCutRequest,
  normalizeGeometryId,
  normalizeGeometryMergeRequest,
  normalizeGeometryRevision,
  normalizeGeometrySyncRequest,
  validateGeometryLineState,
} from './editor-policy.js';

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

  let lineTypeId;
  let lanes;

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
  } else {
    lineTypeId = null;
    lanes = null;

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
  }

  validateGeometryLineState(
    geometry,
    lineTypeId,
    lanes,
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
    lanes,
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

    await assertLineType(
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
          await assertLineType(
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

    async merge(
      payload,
      actor,
      clientIdValue,
    ) {
      const items =
        normalizeGeometryMergeRequest(
          payload,
        );
      const userId =
        actorId(actor);
      const clientId =
        normalizeGeometryEditorClientId(
          clientIdValue,
        );

      return write(
        async (client) => {
          const ids =
            items.map(
              (item) =>
                item.id,
            );

          const locked =
            await storage
              .lockGeometries(
                client,
                [...ids].sort(
                  (
                    left,
                    right,
                  ) =>
                    left - right,
                ),
              );

          const conflicts =
            conflictDetails(
              items,
              locked,
            );

          if (
            conflicts.length > 0
          ) {
            throw new GeometryEditorValidationError(
              'One or more geometries changed before merge',
              409,
              {
                conflicts,
              },
            );
          }

          const mergeLeaseTokens =
            new Map();

          for (const id of ids) {
            const token =
              randomUUID();
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

            if (
              !lease ||
              lease.token !== token
            ) {
              throw new GeometryEditorValidationError(
                'One or more geometries are already being edited',
                409,
                {
                  conflicts: [{
                    id,
                    reason:
                      'edit-lock',
                    lease:
                      publicLease(
                        lease,
                      ),
                  }],
                },
              );
            }

            mergeLeaseTokens.set(
              id,
              token,
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

          const ordered =
            ids.map(
              (id) =>
                byId.get(id),
            );

          const first =
            ordered[0];

          if (
            first.family ===
            'point'
          ) {
            throw new GeometryEditorValidationError(
              'Point geometries cannot be merged',
            );
          }

          if (
            ordered.some(
              (item) =>
                item.family !==
                  first.family,
            )
          ) {
            throw new GeometryEditorValidationError(
              'Merged geometries must have the same geometry family',
            );
          }

          if (
            ordered.some(
              (item) =>
                item.isVisible !==
                first.isVisible,
            )
          ) {
            throw new GeometryEditorValidationError(
              'Merged geometries must have the same visibility',
            );
          }

          if (
            first.family ===
              'line' &&
            ordered.some(
              (item) =>
                item.lineTypeId !==
                  first.lineTypeId ||
                item.lanes !==
                  first.lanes,
            )
          ) {
            throw new GeometryEditorValidationError(
              'Merged lines must have the same line type and lanes',
            );
          }

          const sourceTags =
            JSON.stringify(
              first.sourceTags ??
              {},
            );
          const preserveSourceTags =
            ordered.every(
              (item) =>
                JSON.stringify(
                  item.sourceTags ??
                  {},
                ) === sourceTags,
            );

          const geometry =
            await storage
              .mergeGeometries(
                client,
                ids,
                first.family,
                preserveSourceTags,
              );

          if (!geometry) {
            throw new GeometryEditorValidationError(
              'Merged geometry is empty or invalid',
            );
          }

          await storage
            .relinkGeometry(
              client,
              geometry.id,
            );

          for (
            const [
              geometryId,
              token,
            ] of mergeLeaseTokens
          ) {
            await leaseStorage
              .release(
                client,
                {
                  geometryId,
                  token,
                  userId,
                },
              );
          }

          return {
            geometry:
              await storage
                .getGeometry(
                  client,
                  geometry.id,
                ),
            sourceGeometryIds:
              ids,
          };
        },
      );
    },

    async cut(
      geometryId,
      payload,
      options = {},
      actor,
    ) {
      const id =
        normalizeGeometryId(
          geometryId,
        );
      const cutter =
        normalizeGeometryCutRequest(
          payload,
        );
      const expected =
        normalizeGeometryRevision(
          options
            .expectedUpdatedAt,
        );
      const token =
        normalizeGeometryEditToken(
          options.editToken,
        );
      const userId =
        actorId(actor);

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

          const actual =
            revision(
              previous.updatedAt,
            );

          if (
            actual !== expected
          ) {
            throw new GeometryEditorValidationError(
              'Geometry changed before cut',
              409,
              {
                conflicts: [{
                  id,
                  reason:
                    'changed',
                  expectedUpdatedAt:
                    expected,
                  actualUpdatedAt:
                    actual,
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

          if (
            previous.family !==
            'polygon'
          ) {
            throw new GeometryEditorValidationError(
              'Only polygon geometries can be cut',
            );
          }

          const geometry =
            await storage
              .cutGeometry(
                client,
                id,
                cutter,
              );

          if (!geometry) {
            throw new GeometryEditorValidationError(
              'Cut must overlap only part of the polygon and produce a valid non-empty result',
            );
          }

          await storage
            .relinkGeometry(
              client,
              id,
            );

          return storage
            .getGeometry(
              client,
              id,
            );
        },
      );
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
          const updateIds =
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
            updateIds.length > 0
              ? await storage
                .lockGeometries(
                  client,
                  updateIds,
                )
              : [];

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

          for (
            const update of updates
          ) {
            const ownsLease =
              await leaseStorage
                .owns(
                  client,
                  {
                    geometryId:
                      update.id,
                    token:
                      update.editToken,
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
                      update.id,
                    reason:
                      'edit-lock',
                    lease:
                      publicLease(
                        await leaseStorage
                          .active(
                            client,
                            update.id,
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
          const created = [];
          const updated = [];

          for (
            const item of items
          ) {
            if (
              item.kind ===
              'create'
            ) {
              await assertLineType(
                client,
                item.value,
              );

              const geometry =
                await storage
                  .createGeometry(
                    client,
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
              continue;
            }

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

          const entityIds = [
            ...created.map(
              (item) =>
                item.geometry.id,
            ),
            ...updated.map(
              (item) =>
                item.id,
            ),
          ];

          return {
            createdCount:
              created.length,
            updatedCount:
              updated.length,
            changedCount:
              entityIds.length,
            entityIds,
            created,
            updated,
          };
        },
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
