import {
  normalizeOsmBoundaryBulkUpdates,
  normalizeOsmBoundaryChanges,
  normalizeOsmBoundaryId,
  normalizeOsmBoundaryRevision,
  normalizeOsmSubtreeActive,
  OsmBoundaryAdminValidationError,
} from './boundary-admin-policy.js';

export { OsmBoundaryAdminValidationError };

function own(value, key) {
  return Object.hasOwn(value, key);
}

function boundaryRevision(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return normalizeOsmBoundaryRevision(
    String(value),
  );
}

function assertExpectedRevision(
  boundaryId,
  actual,
  expected,
) {
  if (!expected) return;
  const actualRevision =
    boundaryRevision(actual);
  if (actualRevision === expected) {
    return;
  }
  throw new OsmBoundaryAdminValidationError(
    'OSM boundary changed after the local draft was created',
    409,
    {
      conflicts: [{
        id: boundaryId,
        expectedUpdatedAt: expected,
        actualUpdatedAt: actualRevision,
      }],
    },
  );
}

function nextBoundaryValue(
  previous,
  normalized,
) {
  return {
    active: own(normalized, 'active')
      ? normalized.active
      : previous.active,
    displayName: own(normalized, 'displayName')
      ? normalized.displayName
      : previous.displayName,
    displayType: own(normalized, 'displayType')
      ? normalized.displayType
      : previous.displayType,
    population: own(normalized, 'population')
      ? normalized.population
      : previous.population,
    populationAsOf: own(
      normalized,
      'populationAsOf',
    )
      ? normalized.populationAsOf
      : previous.populationAsOf,
    populationSource: own(
      normalized,
      'populationSource',
    )
      ? normalized.populationSource
      : previous.populationSource,
    attributes: own(normalized, 'attributes')
      ? normalized.attributes
      : previous.attributes,
  };
}

/**
 * OSM boundary administration use case.
 *
 * @param {{ connect: () => Promise<any> }} pool
 * @param {{
 *   storage: {
 *     list(): Promise<any[]>,
 *     getGeometry(boundaryId: number): Promise<any>,
 *     getBoundary(queryable: any, boundaryId: number): Promise<any>,
 *     lockSubtree(client: any, boundaryId: number): Promise<any[]>,
 *     updateSubtreeActive(client: any, ids: number[], active: boolean): Promise<any>,
 *     lockBoundary(client: any, boundaryId: number): Promise<any>,
 *     updateBoundary(client: any, boundaryId: number, value: any): Promise<any>
 *   },
 *   acquireLock: (client: any, pool: any) => Promise<void>,
 *   syncDerivedData: (client: any) => Promise<void>
 * }} dependencies
 */
export function createOsmBoundaryAdminService(
  pool,
  dependencies,
) {
  const storage = dependencies?.storage;
  const acquireLock = dependencies?.acquireLock;
  const syncDerivedData = dependencies?.syncDerivedData;

  if (!storage) {
    throw new TypeError(
      'OSM boundary admin storage dependency is required',
    );
  }
  if (typeof acquireLock !== 'function') {
    throw new TypeError(
      'OSM boundary admin acquireLock dependency is required',
    );
  }
  if (typeof syncDerivedData !== 'function') {
    throw new TypeError(
      'OSM boundary admin syncDerivedData dependency is required',
    );
  }

  return {
    list() {
      return storage.list();
    },

    getGeometry(boundaryId) {
      return storage.getGeometry(
        normalizeOsmBoundaryId(boundaryId),
      );
    },

    async setSubtreeActive(boundaryId, active) {
      const id = normalizeOsmBoundaryId(boundaryId);
      const nextActive = normalizeOsmSubtreeActive(active);
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        await acquireLock(client, pool);

        const subtree = await storage.lockSubtree(
          client,
          id,
        );
        if (subtree.length === 0) {
          await client.query('ROLLBACK');
          return null;
        }

        const ids = subtree.map((row) => row.id);
        const previousActiveCount =
          subtree.filter((row) => row.active).length;
        const previousInactiveCount =
          subtree.length - previousActiveCount;
        const changedCount = nextActive
          ? previousInactiveCount
          : previousActiveCount;

        if (changedCount > 0) {
          await storage.updateSubtreeActive(
            client,
            ids,
            nextActive,
          );
          await syncDerivedData(client);
        }

        const root = await storage.getBoundary(
          client,
          id,
        );

        await client.query('COMMIT');
        return {
          root,
          active: nextActive,
          affectedCount: subtree.length,
          changedCount,
          entityIds: ids,
          previousActiveCount,
          previousInactiveCount,
        };
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (error?.code === '23505') {
          throw new OsmBoundaryAdminValidationError(
            'Cannot activate the whole branch because active OSM ' +
              'objects would have duplicate normalized type and name',
            409,
          );
        }
        throw error;
      } finally {
        client.release();
      }
    },

    async updateMany(payload) {
      const updates =
        normalizeOsmBoundaryBulkUpdates(
          payload,
        );
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        await acquireLock(client, pool);

        const locked = new Map();
        for (
          const update of
          [...updates].sort(
            (left, right) =>
              left.id - right.id,
          )
        ) {
          const previous =
            await storage.lockBoundary(
              client,
              update.id,
            );
          if (!previous) {
            throw new OsmBoundaryAdminValidationError(
              `OSM boundary ${update.id} not found`,
              404,
            );
          }
          assertExpectedRevision(
            update.id,
            previous.updatedAt,
            update.baseUpdatedAt,
          );
          locked.set(
            update.id,
            previous,
          );
        }

        for (const update of updates) {
          await storage.updateBoundary(
            client,
            update.id,
            nextBoundaryValue(
              locked.get(update.id),
              update.changes,
            ),
          );
        }

        await syncDerivedData(client);

        const boundaries = [];
        for (const update of updates) {
          boundaries.push(
            await storage.getBoundary(
              client,
              update.id,
            ),
          );
        }

        await client.query('COMMIT');
        return {
          changedCount:
            boundaries.length,
          entityIds:
            boundaries.map(
              (boundary) =>
                boundary.id,
            ),
          boundaries,
        };
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (error?.code === '23505') {
          throw new OsmBoundaryAdminValidationError(
            'One or more active OSM objects would have duplicate normalized type and name',
            409,
          );
        }
        throw error;
      } finally {
        client.release();
      }
    },

    async update(boundaryId, changes, options = {}) {
      const id = normalizeOsmBoundaryId(boundaryId);
      const normalized =
        normalizeOsmBoundaryChanges(changes);
      const expectedUpdatedAt =
        options.expectedUpdatedAt === undefined ||
        options.expectedUpdatedAt === null ||
        options.expectedUpdatedAt === ''
          ? null
          : normalizeOsmBoundaryRevision(
            options.expectedUpdatedAt,
          );
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        await acquireLock(client, pool);

        const previous = await storage.lockBoundary(
          client,
          id,
        );
        if (!previous) {
          await client.query('ROLLBACK');
          return null;
        }

        assertExpectedRevision(
          id,
          previous.updatedAt,
          expectedUpdatedAt,
        );

        const next =
          nextBoundaryValue(
            previous,
            normalized,
          );

        await storage.updateBoundary(
          client,
          id,
          next,
        );

        await syncDerivedData(client);

        const result = await storage.getBoundary(
          client,
          id,
        );

        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (error?.code === '23505') {
          throw new OsmBoundaryAdminValidationError(
            'An active OSM object with the same normalized type and ' +
              'name already exists',
            409,
          );
        }
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
