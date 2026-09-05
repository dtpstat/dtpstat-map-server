import { throwIfAdminTaskCancelled } from '../data/admin-task-manager.js';
import { buildCityBoundaryGeoJsonPlan } from '../data/city-boundary-geojson-plan.js';

const CREATE_STAGE_SQL = `
  CREATE TEMP TABLE city_boundary_transfer_stage (
    place_type text NOT NULL,
    osm_type text NOT NULL,
    osm_id bigint NOT NULL,
    osm_name text NOT NULL,
    tags jsonb NOT NULL,
    osm_timestamp timestamptz,
    city_slug text,
    city_name text,
    geom geometry(MultiPolygon, 4326) NOT NULL,
    bounds geometry(Polygon, 4326) NOT NULL,
    PRIMARY KEY (osm_type, osm_id)
  ) ON COMMIT DROP
`;

const INSERT_STAGE_SQL = `
  WITH payload_rows AS (
    SELECT *
    FROM jsonb_to_recordset($1::jsonb) AS payload(
      "placeType" text,
      "osmType" text,
      "osmId" bigint,
      "osmName" text,
      tags jsonb,
      "osmTimestamp" timestamptz,
      "citySlug" text,
      "cityName" text,
      geometry jsonb
    )
  ),
  prepared AS (
    SELECT
      payload_rows.*,
      ST_Multi(
        ST_CollectionExtract(
          ST_SetSRID(ST_GeomFromGeoJSON(payload_rows.geometry::text), 4326),
          3
        )
      ) AS geom
    FROM payload_rows
  )
  INSERT INTO city_boundary_transfer_stage (
    place_type,
    osm_type,
    osm_id,
    osm_name,
    tags,
    osm_timestamp,
    city_slug,
    city_name,
    geom,
    bounds
  )
  SELECT
    "placeType",
    "osmType",
    "osmId",
    "osmName",
    tags,
    "osmTimestamp",
    "citySlug",
    "cityName",
    geom,
    ST_Envelope(geom)
  FROM prepared
`;

const INVALID_STAGE_SQL = `
  SELECT osm_type, osm_id, osm_name
  FROM city_boundary_transfer_stage
  WHERE ST_IsEmpty(geom)
     OR NOT ST_IsValid(geom)
     OR ST_Area(geom::geography) <= 0
  ORDER BY osm_type, osm_id
`;

const PRESERVE_GEOMETRY_LINKS_SQL = `
  CREATE TEMP TABLE old_transfer_geometry_links ON COMMIT DROP AS
  SELECT geometry.id AS geometry_id, boundary.osm_type, boundary.osm_id
  FROM city_geometries AS geometry
  JOIN city_boundaries AS boundary ON boundary.id = geometry.boundary_id
`;

const INSERT_BOUNDARIES_SQL = `
  INSERT INTO city_boundaries (
    city_id,
    place_type,
    osm_type,
    osm_id,
    osm_name,
    tags,
    geom,
    bounds,
    osm_timestamp
  )
  SELECT
    COALESCE(
      (SELECT city.id FROM cities AS city WHERE city.slug = stage.city_slug LIMIT 1),
      (SELECT city.id FROM cities AS city WHERE city.name = stage.city_name LIMIT 1)
    ),
    stage.place_type,
    stage.osm_type,
    stage.osm_id,
    stage.osm_name,
    stage.tags,
    stage.geom,
    stage.bounds,
    stage.osm_timestamp
  FROM city_boundary_transfer_stage AS stage
  ORDER BY stage.osm_type, stage.osm_id
`;

const RESTORE_GEOMETRY_LINKS_SQL = `
  UPDATE city_geometries AS geometry
  SET boundary_id = boundary.id
  FROM old_transfer_geometry_links AS old_link
  JOIN city_boundaries AS boundary
    ON boundary.osm_type = old_link.osm_type
   AND boundary.osm_id = old_link.osm_id
  WHERE geometry.id = old_link.geometry_id
`;

/**
 * Atomically replace the complete OSM city/town boundary snapshot from a
 * portable GeoJSON export. Existing line-to-boundary links survive when the
 * same OSM object exists in the imported snapshot.
 *
 * @param {{ connect: () => Promise<any> }} pool
 */
export function createCityBoundaryTransferService(pool) {
  return {
    /**
     * @param {unknown} collection
     * @param {{ dryRun?: boolean, signal?: AbortSignal, onProgress?: (progress: object) => void, onCommit?: () => void }} operation
     */
    async replaceFromGeoJson(collection, operation = {}) {
      throwIfAdminTaskCancelled(operation.signal);
      const plan = buildCityBoundaryGeoJsonPlan(collection);
      operation.onProgress?.({
        phase: 'validated',
        places: plan.boundaries.length,
      });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `SELECT pg_advisory_xact_lock(hashtext('dtpstat-buslines:data-import'))`,
        );
        throwIfAdminTaskCancelled(operation.signal);
        await client.query(CREATE_STAGE_SQL);
        const stageResult = await client.query(INSERT_STAGE_SQL, [
          JSON.stringify(plan.boundaries),
        ]);
        if (stageResult.rowCount !== plan.boundaries.length) {
          throw new Error('Not every city boundary was staged');
        }
        const invalidResult = await client.query(INVALID_STAGE_SQL);
        if (invalidResult.rows.length > 0) {
          const names = invalidResult.rows
            .slice(0, 20)
            .map((row) => `${row.osm_type}/${row.osm_id} ${row.osm_name}`)
            .join(', ');
          throw new Error(`Imported city boundaries contain invalid polygons: ${names}`);
        }

        await client.query(PRESERVE_GEOMETRY_LINKS_SQL);
        await client.query('DELETE FROM city_boundaries');
        const inserted = await client.query(INSERT_BOUNDARIES_SQL);
        if (inserted.rowCount !== plan.boundaries.length) {
          throw new Error('Not every city boundary was imported');
        }
        const restored = await client.query(RESTORE_GEOMETRY_LINKS_SQL);
        throwIfAdminTaskCancelled(operation.signal);

        const linkedResult = await client.query(`
          SELECT count(*)::integer AS count
          FROM city_boundaries
          WHERE city_id IS NOT NULL
        `);
        const result = {
          dryRun: Boolean(operation.dryRun),
          importedPlaces: plan.boundaries.length,
          linkedCities: linkedResult.rows[0]?.count ?? 0,
          restoredGeometryLinks: restored.rowCount,
          completedAt: new Date().toISOString(),
        };
        operation.onProgress?.({
          phase: 'database',
          places: result.importedPlaces,
          linkedCities: result.linkedCities,
          restoredGeometryLinks: result.restoredGeometryLinks,
        });

        if (operation.dryRun) {
          await client.query('ROLLBACK');
          return result;
        }
        operation.onCommit?.();
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
