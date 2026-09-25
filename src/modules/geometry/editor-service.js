import {
  GeometryEditorValidationError,
  geometryFamily,
  normalizeGeometryBulkUpdates,
  normalizeGeometryChanges,
  normalizeGeometryCreatePayload,
  normalizeGeometryCutRequest,
  normalizeGeometryId,
  normalizeGeometryMergeRequest,
  normalizeGeometryRevision,
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
 *   acquireLock: (client: any, pool: any) => Promise<void>
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

  if (!storage) {
    throw new TypeError(
      'Geometry editor storage dependency is required',
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

    return result;
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

          const boundary =
            await storage
              .activeBoundaryForCity(
                client,
                normalized.cityId,
              );

          if (!boundary) {
            throw new GeometryEditorValidationError(
              'Selected city has no active OSM boundary',
              409,
            );
          }

          const geometry =
            await storage
              .createGeometry(
                client,
                normalized,
                boundary.id,
              );

          if (!geometry) {
            throw new GeometryEditorValidationError(
              'Geometry must be non-empty and valid',
            );
          }

          return geometry;
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

    async merge(payload) {
      const items =
        normalizeGeometryMergeRequest(
          payload,
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
                item.cityId !==
                  first.cityId ||
                item.boundaryId !==
                  first.boundaryId ||
                item.family !==
                  first.family,
            )
          ) {
            throw new GeometryEditorValidationError(
              'Merged geometries must belong to the same city, OSM boundary and geometry family',
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

          return {
            geometry,
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

          return geometry;
        },
      );
    },

    async delete(
      geometryId,
      options = {},
    ) {
      const id =
        normalizeGeometryId(
          geometryId,
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

          await storage
            .deleteGeometry(
              client,
              id,
            );

          return previous;
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
