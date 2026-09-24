import {
  validateReportConfig,
} from './config-policy.js';

function normalizeStoredConfig(row) {
  const stored = row?.config;
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    throw new Error(
      'Report configuration is missing; run database migrations',
    );
  }
  for (const key of ['metrics', 'table_columns', 'csv_columns', 'rank']) {
    if (!Object.hasOwn(stored, key)) {
      throw new Error(
        `Report configuration is incomplete: missing ${key}`,
      );
    }
  }

  return validateReportConfig({
    metrics: stored.metrics,
    tableColumns: stored.table_columns,
    csvColumns: stored.csv_columns,
    rank: stored.rank,
    updatedAt:
      row.updatedAt instanceof Date
        ? row.updatedAt.toISOString()
        : row.updatedAt,
  });
}

async function rollbackQuietly(client) {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Preserve the original failure.
  }
}

/**
 * @param {{ connect: () => Promise<any>, query: (...args: any[]) => Promise<any> }} pool
 * @param {{
 *   repository: {
 *     load(queryable: any): Promise<any>,
 *     lineTypeNames(queryable: any): Promise<string[]>,
 *     save(queryable: any, config: any): Promise<any>
 *   },
 *   materialize: (client: any, config: any) => Promise<any>,
 *   acquireLock: (client: any, pool: any) => Promise<void>
 * }} dependencies
 */
export function createReportConfigService(pool, dependencies) {
  const repository = dependencies?.repository;
  const materialize = dependencies?.materialize;
  const acquireLock = dependencies?.acquireLock;

  if (!repository) {
    throw new TypeError(
      'Report config repository dependency is required',
    );
  }
  if (typeof materialize !== 'function') {
    throw new TypeError(
      'Report materialize dependency is required',
    );
  }
  if (typeof acquireLock !== 'function') {
    throw new TypeError(
      'Report config acquireLock dependency is required',
    );
  }

  return {
    async get() {
      return normalizeStoredConfig(
        await repository.load(pool),
      );
    },

    async refresh() {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await acquireLock(client, pool);
        const config = normalizeStoredConfig(
          await repository.load(client),
        );
        const result = await materialize(client, config);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await rollbackQuietly(client);
        throw error;
      } finally {
        client.release();
      }
    },

    async save(payload) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await acquireLock(client, pool);

        const config = validateReportConfig(payload, {
          allowedLineTypeNames:
            await repository.lineTypeNames(client),
        });

        const updatedAt = await repository.save(client, config);
        const normalized = {
          ...config,
          updatedAt:
            updatedAt instanceof Date
              ? updatedAt.toISOString()
              : updatedAt,
        };
        const materialized =
          await materialize(client, normalized);

        await client.query('COMMIT');
        return {
          config: normalized,
          materialized,
        };
      } catch (error) {
        await rollbackQuietly(client);
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
