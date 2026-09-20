const RESUMABLE_STATUSES = ['downloading', 'failed', 'cancelled', 'ready'];

function mapCheckpoint(row) {
  if (!row) return null;
  const totalObjects = Number(row.totalObjects ?? 0);
  const stagedObjects = Number(row.stagedObjects ?? 0);
  return {
    id: Number(row.id),
    status: row.status,
    sourceURL: row.sourceURL,
    settingsFingerprint: row.settingsFingerprint,
    indexFingerprint: row.indexFingerprint,
    options: row.options,
    sourceElements: Number(row.sourceElements ?? 0),
    duplicateIndexObjects: Number(row.duplicateIndexObjects ?? 0),
    osmTimestamp: row.osmTimestamp,
    downloadedBytes: Number(row.downloadedBytes ?? 0),
    requestAttemptCount: Number(row.requestAttemptCount ?? 0),
    retryCount: Number(row.retryCount ?? 0),
    retryWaitMs: Number(row.retryWaitMs ?? 0),
    throttleWaitMs: Number(row.throttleWaitMs ?? 0),
    ignoredElements: Number(row.ignoredElements ?? 0),
    totalObjects,
    stagedObjects,
    remainingObjects: Math.max(0, totalObjects - stagedObjects),
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
    checkpoint.last_error AS "lastError",
    checkpoint.created_at AS "createdAt",
    checkpoint.updated_at AS "updatedAt",
    checkpoint.completed_at AS "completedAt",
    jsonb_array_length(checkpoint.index_objects)::integer AS "totalObjects",
    COUNT(stage.osm_id)::integer AS "stagedObjects"
  FROM osm_city_update_checkpoints AS checkpoint
  LEFT JOIN osm_city_update_checkpoint_stage AS stage
    ON stage.checkpoint_id = checkpoint.id
`;

const STAGE_BATCH_SQL = `
  WITH payload_rows AS (
    SELECT *
    FROM jsonb_to_recordset($2::jsonb) AS payload(
      name text,
      "placeType" text,
      "adminLevel" smallint,
      "osmType" text,
      "osmId" bigint,
      tags jsonb,
      linework jsonb,
      "contentChecksum" text
    )
  ),
  polygons AS (
    SELECT
      payload_rows.*,
      ST_Multi(
        ST_CollectionExtract(
          ST_MakeValid(
            ST_BuildArea(
              ST_Node(
                ST_SetSRID(
                  ST_GeomFromGeoJSON(payload_rows.linework::text),
                  4326
                )
              )
            )
          ),
          3
        )
      ) AS geom
    FROM payload_rows
  )
  INSERT INTO osm_city_update_checkpoint_stage (
    checkpoint_id,
    osm_type,
    osm_id,
    name,
    place_type,
    admin_level,
    tags,
    geom,
    bounds,
    content_checksum,
    staged_at
  )
  SELECT
    $1,
    "osmType",
    "osmId",
    name,
    "placeType",
    "adminLevel",
    tags,
    geom,
    ST_Envelope(geom),
    "contentChecksum",
    NOW()
  FROM polygons
  ON CONFLICT (checkpoint_id, osm_type, osm_id) DO UPDATE SET
    name = EXCLUDED.name,
    place_type = EXCLUDED.place_type,
    admin_level = EXCLUDED.admin_level,
    tags = EXCLUDED.tags,
    geom = EXCLUDED.geom,
    bounds = EXCLUDED.bounds,
    content_checksum = EXCLUDED.content_checksum,
    staged_at = NOW()
`;

export function createOsmCityCheckpointRepository(pool) {
  const query = (text, parameters = []) => pool.query(text, parameters);

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
      const result = await query(`
        ${CHECKPOINT_SELECT}
        WHERE checkpoint.status = ANY($1::text[])
        GROUP BY checkpoint.id
        ORDER BY checkpoint.updated_at DESC, checkpoint.id DESC
        LIMIT 1
      `, [RESUMABLE_STATUSES]);
      return mapCheckpoint(result.rows[0]);
    },

    async getById(checkpointId) {
      const result = await query(`
        ${CHECKPOINT_SELECT}
        WHERE checkpoint.id = $1
        GROUP BY checkpoint.id
      `, [checkpointId]);
      return mapCheckpoint(result.rows[0]);
    },

    async getIndexObjects(checkpointId) {
      const result = await query(
        `SELECT index_objects AS objects
         FROM osm_city_update_checkpoints
         WHERE id = $1`,
        [checkpointId],
      );
      return result.rows[0]?.objects ?? null;
    },

    async create({
      sourceURL,
      settingsFingerprint,
      indexFingerprint,
      options,
      indexObjects,
      sourceElements,
      duplicateIndexObjects,
      osmTimestamp,
      downloadedBytes,
      requestAttemptCount,
      retryCount,
      retryWaitMs,
      throttleWaitMs,
    }) {
      const result = await query(
        `INSERT INTO osm_city_update_checkpoints (
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
         RETURNING id::bigint::text AS id`,
        [
          sourceURL,
          settingsFingerprint,
          indexFingerprint,
          JSON.stringify(options),
          JSON.stringify(indexObjects),
          sourceElements,
          duplicateIndexObjects,
          osmTimestamp,
          downloadedBytes,
          requestAttemptCount,
          retryCount,
          retryWaitMs,
          throttleWaitMs,
        ],
      );
      return this.getById(Number(result.rows[0].id));
    },

    async getStagedKeys(checkpointId) {
      const result = await query(
        `SELECT osm_type AS "osmType", osm_id::bigint::text AS "osmId"
         FROM osm_city_update_checkpoint_stage
         WHERE checkpoint_id = $1`,
        [checkpointId],
      );
      return new Set(result.rows.map((row) => `${row.osmType}/${row.osmId}`));
    },

    async stageBatch(checkpointId, places, metrics = {}) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const staged = await client.query(
          STAGE_BATCH_SQL,
          [checkpointId, JSON.stringify(places)],
        );
        if (staged.rowCount !== places.length) {
          throw new Error('Not every OSM place in checkpoint batch was staged');
        }

        const identities = places.map((place) => ({
          osmType: place.osmType,
          osmId: place.osmId,
        }));
        const invalid = await client.query(
          `WITH identities AS (
             SELECT *
             FROM jsonb_to_recordset($2::jsonb)
               AS item("osmType" text, "osmId" bigint)
           )
           SELECT stage.name
           FROM osm_city_update_checkpoint_stage AS stage
           JOIN identities
             ON identities."osmType" = stage.osm_type
            AND identities."osmId" = stage.osm_id
           WHERE stage.checkpoint_id = $1
             AND (
               ST_IsEmpty(stage.geom)
               OR NOT ST_IsValid(stage.geom)
               OR ST_Area(stage.geom::geography) <= 0
             )
           ORDER BY stage.name`,
          [checkpointId, JSON.stringify(identities)],
        );
        if (invalid.rowCount > 0) {
          throw new Error(
            `OSM geometry does not form a valid place polygon: ` +
            invalid.rows.map((row) => row.name).join(', '),
          );
        }

        await client.query(
          `UPDATE osm_city_update_checkpoints
           SET status = 'downloading',
               downloaded_bytes = downloaded_bytes + $2,
               request_attempt_count = request_attempt_count + $3,
               retry_count = retry_count + $4,
               retry_wait_ms = retry_wait_ms + $5,
               throttle_wait_ms = throttle_wait_ms + $6,
               ignored_elements = ignored_elements + $7,
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
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
      return this.getById(checkpointId);
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
          lastError === null ? null : JSON.stringify(lastError),
        ],
      );
      return this.getById(checkpointId);
    },

    async discard(checkpointId) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          'DELETE FROM osm_city_update_checkpoint_stage WHERE checkpoint_id = $1',
          [checkpointId],
        );
        await client.query(
          `UPDATE osm_city_update_checkpoints
           SET status = 'discarded',
               index_objects = '[]'::jsonb,
               last_error = NULL,
               updated_at = NOW(),
               completed_at = NOW()
           WHERE id = $1`,
          [checkpointId],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    async stats(checkpointId) {
      const result = await query(
        `SELECT
           COUNT(*)::integer AS "stagedObjects",
           COUNT(*) FILTER (WHERE place_type = 'city')::integer AS "cityPlaces",
           COUNT(*) FILTER (WHERE place_type = 'town')::integer AS "townPlaces",
           COUNT(*) FILTER (
             WHERE admin_level IS NOT NULL AND place_type IS NULL
           )::integer AS "administrativePlaces",
           (
             SELECT COUNT(*)::integer
             FROM (
               SELECT name
               FROM osm_city_update_checkpoint_stage
               WHERE checkpoint_id = $1
               GROUP BY name
               HAVING COUNT(*) > 1
             ) AS duplicate_names
           ) AS "duplicateNames"
         FROM osm_city_update_checkpoint_stage
         WHERE checkpoint_id = $1`,
        [checkpointId],
      );
      return result.rows[0];
    },

    async checksums(checkpointId) {
      const result = await query(
        `SELECT
           osm_type AS "osmType",
           osm_id::bigint::text AS "osmId",
           content_checksum AS "contentChecksum"
         FROM osm_city_update_checkpoint_stage
         WHERE checkpoint_id = $1
         ORDER BY osm_type, osm_id`,
        [checkpointId],
      );
      return result.rows;
    },
  };
}
