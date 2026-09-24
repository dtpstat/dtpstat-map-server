export const OSM_RESUMABLE_CHECKPOINT_STATUSES = [
  'downloading',
  'failed',
  'cancelled',
  'ready',
];

function mapCheckpoint(row) {
  if (!row) return null;

  const totalObjects = Number(row.totalObjects ?? 0);
  const stagedObjects = Number(row.stagedObjects ?? 0);
  const geometryObjects = Number(row.geometryObjects ?? 0);
  const unbuildableGeometryObjects = Number(
    row.unbuildableGeometryObjects ?? 0,
  );

  return {
    id: Number(row.id),
    status: row.status,
    sourceURL: row.sourceURL,
    settingsFingerprint: row.settingsFingerprint,
    indexFingerprint: row.indexFingerprint,
    options: row.options,
    sourceElements: Number(row.sourceElements ?? 0),
    duplicateIndexObjects: Number(
      row.duplicateIndexObjects ?? 0,
    ),
    osmTimestamp: row.osmTimestamp,
    downloadedBytes: Number(row.downloadedBytes ?? 0),
    requestAttemptCount: Number(
      row.requestAttemptCount ?? 0,
    ),
    retryCount: Number(row.retryCount ?? 0),
    retryWaitMs: Number(row.retryWaitMs ?? 0),
    throttleWaitMs: Number(row.throttleWaitMs ?? 0),
    ignoredElements: Number(row.ignoredElements ?? 0),
    stagedBatchCount: Number(row.stagedBatchCount ?? 0),
    totalObjects,
    stagedObjects,
    geometryObjects,
    unbuildableGeometryObjects,
    remainingObjects: Math.max(
      0,
      totalObjects - stagedObjects,
    ),
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
  };
}

const CHECKPOINT_SELECT = `
  SELECT
    checkpoint.id::bigint::text AS id,
    checkpoint.status,
    checkpoint.source_url AS "sourceURL",
    checkpoint.settings_fingerprint AS "settingsFingerprint",
    checkpoint.index_fingerprint AS "indexFingerprint",
    checkpoint.options,
    checkpoint.source_elements::integer AS "sourceElements",
    checkpoint.duplicate_index_objects::integer AS "duplicateIndexObjects",
    checkpoint.osm_timestamp AS "osmTimestamp",
    checkpoint.downloaded_bytes::bigint::text AS "downloadedBytes",
    checkpoint.request_attempt_count::integer AS "requestAttemptCount",
    checkpoint.retry_count::integer AS "retryCount",
    checkpoint.retry_wait_ms::bigint::text AS "retryWaitMs",
    checkpoint.throttle_wait_ms::bigint::text AS "throttleWaitMs",
    checkpoint.ignored_elements::integer AS "ignoredElements",
    checkpoint.staged_batch_count::integer AS "stagedBatchCount",
    checkpoint.last_error AS "lastError",
    checkpoint.created_at AS "createdAt",
    checkpoint.updated_at AS "updatedAt",
    checkpoint.completed_at AS "completedAt",
    jsonb_array_length(checkpoint.index_objects)::integer AS "totalObjects",
    COUNT(stage.osm_id)::integer AS "stagedObjects",
    (
      COUNT(stage.osm_id)
      FILTER (WHERE stage.geometry_status = 'ready')
    )::integer AS "geometryObjects",
    (
      COUNT(stage.osm_id)
      FILTER (WHERE stage.geometry_status = 'unbuildable')
    )::integer AS "unbuildableGeometryObjects"
  FROM osm_city_update_checkpoints AS checkpoint
  LEFT JOIN osm_city_update_checkpoint_stage AS stage
    ON stage.checkpoint_id = checkpoint.id
`;

function checkpointInsertValues(value) {
  return [
    value.sourceURL,
    value.settingsFingerprint,
    value.indexFingerprint,
    JSON.stringify(value.options),
    JSON.stringify(value.indexObjects),
    value.sourceElements,
    value.duplicateIndexObjects,
    value.osmTimestamp,
    value.downloadedBytes,
    value.requestAttemptCount,
    value.retryCount,
    value.retryWaitMs,
    value.throttleWaitMs,
  ];
}

const INSERT_CHECKPOINT_SQL = `
  INSERT INTO osm_city_update_checkpoints (
    status,
    source_url,
    settings_fingerprint,
    index_fingerprint,
    options,
    index_objects,
    source_elements,
    duplicate_index_objects,
    osm_timestamp,
    downloaded_bytes,
    request_attempt_count,
    retry_count,
    retry_wait_ms,
    throttle_wait_ms
  )
  VALUES (
    'downloading', $1, $2, $3, $4::jsonb, $5::jsonb,
    $6, $7, $8::timestamptz, $9, $10, $11, $12, $13
  )
  RETURNING id::bigint::text AS id
`;

/** @param {{ query: Function }} database */
export function createOsmCheckpointRecordRepository(database) {
  const query = (text, parameters = []) =>
    database.query(text, parameters);

  async function getById(checkpointId) {
    const result = await query(
      `${CHECKPOINT_SELECT}
       WHERE checkpoint.id = $1
       GROUP BY checkpoint.id`,
      [checkpointId],
    );
    return mapCheckpoint(result.rows[0]);
  }

  return {
    async cleanup() {
      const result = await query(`
        WITH expired AS (
          SELECT id
          FROM osm_city_update_checkpoints
          WHERE
            (
              status IN ('completed', 'discarded')
              AND updated_at < NOW() - INTERVAL '7 days'
            )
            OR
            (
              status IN ('failed', 'cancelled')
              AND updated_at < NOW() - INTERVAL '90 days'
            )
        )
        DELETE FROM osm_city_update_checkpoints AS checkpoint
        USING expired
        WHERE checkpoint.id = expired.id
        RETURNING checkpoint.id
      `);
      return result.rowCount;
    },

    async getResumable() {
      const result = await query(
        `${CHECKPOINT_SELECT}
         WHERE checkpoint.status = ANY($1::text[])
         GROUP BY checkpoint.id
         ORDER BY checkpoint.updated_at DESC, checkpoint.id DESC
         LIMIT 1`,
        [OSM_RESUMABLE_CHECKPOINT_STATUSES],
      );
      return mapCheckpoint(result.rows[0]);
    },

    getById,

    async getIndexObjects(checkpointId) {
      const result = await query(
        `SELECT index_objects AS objects
         FROM osm_city_update_checkpoints
         WHERE id = $1`,
        [checkpointId],
      );
      return result.rows[0]?.objects ?? null;
    },

    async insert(queryable, value) {
      const result = await queryable.query(
        INSERT_CHECKPOINT_SQL,
        checkpointInsertValues(value),
      );
      return Number(result.rows[0].id);
    },

    async create(value) {
      const checkpointId = await this.insert(
        database,
        value,
      );
      return getById(checkpointId);
    },

    async lockResumable(queryable, checkpointId) {
      const result = await queryable.query(
        `SELECT id
         FROM osm_city_update_checkpoints
         WHERE id = $1
           AND status = ANY($2::text[])
         FOR UPDATE`,
        [
          checkpointId,
          OSM_RESUMABLE_CHECKPOINT_STATUSES,
        ],
      );
      return result.rowCount === 1;
    },

    discardRecord(queryable, checkpointId) {
      return queryable.query(
        `UPDATE osm_city_update_checkpoints
         SET status = 'discarded',
             index_objects = '[]'::jsonb,
             last_error = NULL,
             updated_at = NOW(),
             completed_at = NOW()
         WHERE id = $1`,
        [checkpointId],
      );
    },

    completeRecord(queryable, checkpointId) {
      return queryable.query(
        `UPDATE osm_city_update_checkpoints
         SET status = 'completed',
             index_objects = '[]'::jsonb,
             last_error = NULL,
             completed_at = NOW(),
             updated_at = NOW()
         WHERE id = $1`,
        [checkpointId],
      );
    },

    addBatchMetrics(queryable, checkpointId, metrics = {}) {
      return queryable.query(
        `UPDATE osm_city_update_checkpoints
         SET status = 'downloading',
             downloaded_bytes = downloaded_bytes + $2,
             request_attempt_count = request_attempt_count + $3,
             retry_count = retry_count + $4,
             retry_wait_ms = retry_wait_ms + $5,
             throttle_wait_ms = throttle_wait_ms + $6,
             ignored_elements = ignored_elements + $7,
             staged_batch_count = staged_batch_count + 1,
             last_error = NULL,
             updated_at = NOW()
         WHERE id = $1`,
        [
          checkpointId,
          metrics.downloadedBytes ?? 0,
          metrics.requestAttemptCount ?? 0,
          metrics.retryCount ?? 0,
          metrics.retryWaitMs ?? 0,
          metrics.throttleWaitMs ?? 0,
          metrics.ignoredElements ?? 0,
        ],
      );
    },

    async addMetrics(checkpointId, metrics = {}) {
      await query(
        `UPDATE osm_city_update_checkpoints
         SET downloaded_bytes = downloaded_bytes + $2,
             request_attempt_count = request_attempt_count + $3,
             retry_count = retry_count + $4,
             retry_wait_ms = retry_wait_ms + $5,
             throttle_wait_ms = throttle_wait_ms + $6,
             updated_at = NOW()
         WHERE id = $1`,
        [
          checkpointId,
          metrics.downloadedBytes ?? 0,
          metrics.requestAttemptCount ?? 0,
          metrics.retryCount ?? 0,
          metrics.retryWaitMs ?? 0,
          metrics.throttleWaitMs ?? 0,
        ],
      );
    },

    async mark(checkpointId, status, lastError = null) {
      await query(
        `UPDATE osm_city_update_checkpoints
         SET status = $2,
             last_error = $3::jsonb,
             updated_at = NOW()
         WHERE id = $1`,
        [
          checkpointId,
          status,
          lastError === null
            ? null
            : JSON.stringify(lastError),
        ],
      );
      return getById(checkpointId);
    },
  };
}
