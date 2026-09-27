import { throwIfAdminTaskCancelled } from '../shared/tasks/admin-task-manager.js';

export const CITY_BOUNDARY_HIERARCHY_BATCH_SIZE = 250;

const COUNT_BOUNDARIES_SQL = `
  SELECT count(*)::integer AS count
  FROM city_boundaries
`;

const REBUILD_HIERARCHY_BATCH_SQL = `
  WITH batch AS (
    SELECT boundary.id
    FROM city_boundaries AS boundary
    WHERE boundary.id > $1::bigint
    ORDER BY boundary.id
    LIMIT $2
  ),
  updated AS (
    UPDATE city_boundaries AS child
    SET parent_id = (
      SELECT parent.id
      FROM city_boundaries AS parent
      WHERE parent.id <> child.id
        AND parent.geom && child.geom
        AND parent.area_m2 > child.area_m2
        AND NOT ST_Equals(parent.geom, child.geom)
        AND ST_Covers(parent.geom, child.geom)
      ORDER BY parent.area_m2, parent.id
      LIMIT 1
    )
    FROM batch
    WHERE child.id = batch.id
    RETURNING child.id
  )
  SELECT
    count(*)::integer AS count,
    max(id)::text AS "lastId"
  FROM updated
`;

/**
 * Rebuild parent_id only. area_m2 must already be current for all rows.
 *
 * Doing this in bounded batches makes the long PostGIS containment phase
 * observable and gives cancellation a checkpoint between DB statements.
 *
 * @param {{ query: Function }} client
 * @param {{
 *   signal?: AbortSignal,
 *   batchSize?: number,
 *   onProgress?: (progress: object) => void
 * }} operation
 */
export async function rebuildCityBoundaryHierarchy(client, operation = {}) {
  const batchSize = operation.batchSize ??
    CITY_BOUNDARY_HIERARCHY_BATCH_SIZE;
  const countResult = await client.query(COUNT_BOUNDARIES_SQL);
  const total = Number(countResult.rows[0]?.count ?? 0);
  const batchCount = total > 0 ? Math.ceil(total / batchSize) : 0;

  let processed = 0;
  let batch = 0;
  let lastId = '0';

  operation.onProgress?.({
    phase: 'hierarchy',
    processed,
    total,
    batch,
    batchCount,
  });

  while (processed < total) {
    throwIfAdminTaskCancelled(operation.signal);
    const result = await client.query(
      REBUILD_HIERARCHY_BATCH_SQL,
      [lastId, batchSize],
    );
    const row = result.rows[0];
    const count = Number(row?.count ?? 0);
    if (count <= 0 || !row?.lastId) {
      throw new Error(
        `Boundary hierarchy rebuild stopped after ${processed}/${total} rows`,
      );
    }

    processed += count;
    batch += 1;
    lastId = row.lastId;
    operation.onProgress?.({
      phase: 'hierarchy',
      processed,
      total,
      batch,
      batchCount,
    });
  }

  return {
    processed,
    total,
    batch,
    batchCount,
  };
}
