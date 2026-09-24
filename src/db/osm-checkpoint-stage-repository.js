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
    geometry_status,
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
    CASE WHEN geom IS NULL THEN 'unbuildable' ELSE 'ready' END,
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
    geometry_status = EXCLUDED.geometry_status,
    content_checksum = EXCLUDED.content_checksum,
    staged_at = NOW()
  RETURNING geometry_status AS "geometryStatus"
`;

/** @param {{ query: Function }} database */
export function createOsmCheckpointStageRepository(database) {
  const query = (text, parameters = []) =>
    database.query(text, parameters);

  return {
    async getStagedKeys(checkpointId) {
      const result = await query(
        `SELECT
           osm_type AS "osmType",
           osm_id::bigint::text AS "osmId"
         FROM osm_city_update_checkpoint_stage
         WHERE checkpoint_id = $1`,
        [checkpointId],
      );
      return new Set(
        result.rows.map(
          (row) => `${row.osmType}/${row.osmId}`,
        ),
      );
    },

    async stageBatch(queryable, checkpointId, places) {
      const staged = await queryable.query(
        STAGE_BATCH_SQL,
        [checkpointId, JSON.stringify(places)],
      );
      if (staged.rowCount !== places.length) {
        throw new Error(
          'Not every OSM place in checkpoint batch was staged',
        );
      }

      const batchUnbuildableGeometryObjects =
        staged.rows.filter(
          (row) => row.geometryStatus === 'unbuildable',
        ).length;

      const identities = places.map((place) => ({
        osmType: place.osmType,
        osmId: place.osmId,
      }));

      const invalid = await queryable.query(
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
           AND stage.geometry_status = 'ready'
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
          'OSM geometry does not form a valid place polygon: ' +
            invalid.rows
              .map((row) => row.name)
              .join(', '),
        );
      }

      return {
        batchGeometryObjects:
          places.length -
          batchUnbuildableGeometryObjects,
        batchUnbuildableGeometryObjects,
      };
    },

    deleteByCheckpoint(queryable, checkpointId) {
      return queryable.query(
        `DELETE FROM osm_city_update_checkpoint_stage
         WHERE checkpoint_id = $1`,
        [checkpointId],
      );
    },

    async stats(checkpointId) {
      const result = await query(
        `SELECT
           COUNT(*)::integer AS "stagedObjects",
           COUNT(*) FILTER (
             WHERE geometry_status = 'ready'
           )::integer AS "geometryObjects",
           COUNT(*) FILTER (
             WHERE geometry_status = 'unbuildable'
           )::integer AS "unbuildableGeometryObjects",
           COUNT(*) FILTER (
             WHERE geometry_status = 'ready'
               AND place_type = 'city'
           )::integer AS "cityPlaces",
           COUNT(*) FILTER (
             WHERE geometry_status = 'ready'
               AND place_type = 'town'
           )::integer AS "townPlaces",
           COUNT(*) FILTER (
             WHERE geometry_status = 'ready'
               AND admin_level IS NOT NULL
           )::integer AS "administrativePlaces",
           (
             SELECT COUNT(*)::integer
             FROM (
               SELECT name
               FROM osm_city_update_checkpoint_stage
               WHERE checkpoint_id = $1
                 AND geometry_status = 'ready'
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
