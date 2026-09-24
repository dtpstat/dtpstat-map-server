import {
  normalizeOsmBoundaryChanges,
  normalizeOsmBoundaryId,
  normalizeOsmSubtreeActive,
  OsmBoundaryAdminValidationError,
} from './boundary-admin-policy.js';

export { OsmBoundaryAdminValidationError };

function own(value, key) {
  return Object.hasOwn(value, key);
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

    async update(boundaryId, changes) {
      const id = normalizeOsmBoundaryId(boundaryId);
      const normalized =
        normalizeOsmBoundaryChanges(changes);
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

        const next = {
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
