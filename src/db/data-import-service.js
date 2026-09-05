import { buildGeoJsonPlan, GeoJsonValidationError } from '../data/geojson-plan.js';
import { throwIfAdminTaskCancelled } from '../data/admin-task-manager.js';
import { RECALCULATE_CITY_STATISTICS_SQL } from './recalculate-city-statistics.js';

const UPSERT_CITIES_SQL = `
  INSERT INTO cities (
    slug,
    name,
    full_name,
    lane_length_m,
    attributes
  )
  SELECT
    payload.slug,
    payload.name,
    payload."fullName",
    0,
    payload.attributes
  FROM jsonb_to_recordset($1::jsonb) AS payload(
    slug text,
    name text,
    "fullName" text,
    attributes jsonb
  )
  ON CONFLICT (name) DO UPDATE SET
    slug = EXCLUDED.slug,
    full_name = EXCLUDED.full_name,
    attributes = cities.attributes || EXCLUDED.attributes,
    updated_at = now()
`;

const UPSERT_LINE_TYPES_SQL = `
  INSERT INTO line_types (code, name, color, line_style, width)
  SELECT
    payload.type,
    payload.name,
    payload.color,
    payload.style,
    payload.width
  FROM jsonb_to_recordset($1::jsonb) AS payload(
    type text,
    name text,
    color text,
    style text,
    width double precision
  )
  ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    color = EXCLUDED.color,
    line_style = EXCLUDED.line_style,
    width = EXCLUDED.width,
    updated_at = now()
`;

const FIND_UNKNOWN_BOUNDARIES_SQL = `
  SELECT DISTINCT
    payload."boundaryOsmType" AS osm_type,
    payload."boundaryOsmId" AS osm_id
  FROM jsonb_to_recordset($1::jsonb) AS payload(
    "boundaryOsmType" text,
    "boundaryOsmId" bigint
  )
  LEFT JOIN city_boundaries AS boundary
    ON boundary.osm_type = payload."boundaryOsmType"
   AND boundary.osm_id = payload."boundaryOsmId"
  WHERE payload."boundaryOsmId" IS NOT NULL
    AND boundary.id IS NULL
  ORDER BY osm_type, osm_id
`;

const FIND_UNKNOWN_LINE_TYPES_SQL = `
  SELECT DISTINCT payload."lineType" AS line_type
  FROM jsonb_to_recordset($1::jsonb) AS payload("lineType" text)
  LEFT JOIN line_types AS line_type ON line_type.code = payload."lineType"
  WHERE line_type.id IS NULL
  ORDER BY payload."lineType"
`;

const FIND_BOUNDARY_CITY_CONFLICTS_SQL = `
  WITH payload_rows AS (
    SELECT *
    FROM jsonb_to_recordset($1::jsonb) AS payload(
      "citySlug" text,
      "boundaryOsmType" text,
      "boundaryOsmId" bigint
    )
  )
  SELECT DISTINCT
    boundary.osm_type,
    boundary.osm_id,
    boundary.city_id AS existing_city_id,
    city.id AS imported_city_id
  FROM payload_rows AS payload
  JOIN city_boundaries AS boundary
    ON boundary.osm_type = payload."boundaryOsmType"
   AND boundary.osm_id = payload."boundaryOsmId"
  JOIN cities AS city ON city.slug = payload."citySlug"
  WHERE boundary.city_id IS NOT NULL
    AND boundary.city_id <> city.id
  ORDER BY boundary.osm_type, boundary.osm_id
`;

const LINK_BOUNDARIES_SQL = `
  WITH payload_rows AS (
    SELECT DISTINCT
      payload."citySlug" AS city_slug,
      payload."boundaryOsmType" AS osm_type,
      payload."boundaryOsmId" AS osm_id
    FROM jsonb_to_recordset($1::jsonb) AS payload(
      "citySlug" text,
      "boundaryOsmType" text,
      "boundaryOsmId" bigint
    )
    WHERE payload."citySlug" IS NOT NULL
      AND payload."boundaryOsmId" IS NOT NULL
  )
  UPDATE city_boundaries AS boundary
  SET city_id = city.id,
      updated_at = now()
  FROM payload_rows AS payload
  JOIN cities AS city ON city.slug = payload.city_slug
  WHERE boundary.osm_type = payload.osm_type
    AND boundary.osm_id = payload.osm_id
    AND boundary.city_id IS NULL
`;

const INSERT_GEOMETRIES_SQL = `
  WITH payload_rows AS (
    SELECT *
    FROM jsonb_to_recordset($1::jsonb) AS payload(
      "cityName" text,
      "citySlug" text,
      "boundaryOsmType" text,
      "boundaryOsmId" bigint,
      "lineType" text,
      lanes smallint,
      properties jsonb,
      geometry jsonb
    )
  ),
  prepared AS (
    SELECT
      payload_rows.*,
      ST_SetSRID(
        ST_GeomFromGeoJSON(payload_rows.geometry::text),
        4326
      ) AS geom
    FROM payload_rows
  )
  INSERT INTO city_geometries (
    city_id,
    boundary_id,
    line_type_id,
    lanes,
    length_m,
    lane_length_m,
    properties,
    geom
  )
  SELECT
    city.id,
    boundary.id,
    line_type.id,
    prepared.lanes,
    ST_Length(prepared.geom::geography),
    ST_Length(prepared.geom::geography) * prepared.lanes,
    prepared.properties,
    prepared.geom
  FROM prepared
  JOIN line_types AS line_type ON line_type.code = prepared."lineType"
  LEFT JOIN cities AS city ON city.slug = prepared."citySlug"
  LEFT JOIN city_boundaries AS boundary
    ON boundary.osm_type = prepared."boundaryOsmType"
   AND boundary.osm_id = prepared."boundaryOsmId"
`;

/**
 * @typedef {{
 *   query: (text: string, values?: unknown[]) => Promise<{ rows: any[], rowCount?: number }>,
 *   release: () => void
 * }} DatabaseClient
 */

/**
 * Atomically replace all line geometry data from one complete GeoJSON upload.
 * Versioned exports restore city, OSM-boundary and line-type links using
 * portable natural keys; legacy GeoJSON remains supported through `default`.
 *
 * @param {{ connect: () => Promise<DatabaseClient> }} pool
 */
export function createDataImportService(pool) {
  return {
    /**
     * @param {unknown} collection
     * @param {{ signal?: AbortSignal, onProgress?: (progress: object) => void, onCommit?: () => void }} operation
     */
    async replaceFromGeoJson(collection, operation = {}) {
      throwIfAdminTaskCancelled(operation.signal);
      const plan = buildGeoJsonPlan(collection);
      operation.onProgress?.({
        phase: 'validated',
        cities: plan.cities.length,
        geometries: plan.geometries.length,
        lineTypes: plan.lineTypes.length,
        ignoredFeatures: plan.ignoredFeatures.length,
      });
      throwIfAdminTaskCancelled(operation.signal);
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        await client.query(
          `SELECT pg_advisory_xact_lock(hashtext('dtpstat-buslines:data-import'))`,
        );
        throwIfAdminTaskCancelled(operation.signal);

        await client.query(UPSERT_CITIES_SQL, [JSON.stringify(plan.cities)]);
        if (plan.lineTypes.length > 0) {
          await client.query(UPSERT_LINE_TYPES_SQL, [JSON.stringify(plan.lineTypes)]);
        }

        const serializedGeometries = JSON.stringify(plan.geometries);
        const unknownLineTypes = await client.query(
          FIND_UNKNOWN_LINE_TYPES_SQL,
          [serializedGeometries],
        );
        if (unknownLineTypes.rows.length > 0) {
          throw new GeoJsonValidationError(
            `Line GeoJSON references unknown line types: ${unknownLineTypes.rows.map((row) => row.line_type).join(', ')}`,
          );
        }

        const unknownBoundaries = await client.query(
          FIND_UNKNOWN_BOUNDARIES_SQL,
          [serializedGeometries],
        );
        if (unknownBoundaries.rows.length > 0) {
          const objects = unknownBoundaries.rows
            .slice(0, 30)
            .map((row) => `${row.osm_type}/${row.osm_id}`)
            .join(', ');
          throw new GeoJsonValidationError(
            `Line GeoJSON references unknown city boundaries: ${objects}. Import the city GeoJSON snapshot first.`,
          );
        }
        const conflicts = await client.query(
          FIND_BOUNDARY_CITY_CONFLICTS_SQL,
          [serializedGeometries],
        );
        if (conflicts.rows.length > 0) {
          const objects = conflicts.rows
            .slice(0, 30)
            .map((row) => `${row.osm_type}/${row.osm_id}`)
            .join(', ');
          throw new GeoJsonValidationError(
            `Line GeoJSON conflicts with existing city-boundary links: ${objects}`,
          );
        }
        await client.query(LINK_BOUNDARIES_SQL, [serializedGeometries]);

        await client.query('DELETE FROM city_geometries');
        const geometryResult = await client.query(INSERT_GEOMETRIES_SQL, [
          serializedGeometries,
        ]);
        const statisticsResult = await client.query(
          RECALCULATE_CITY_STATISTICS_SQL,
        );

        if (geometryResult.rowCount !== plan.geometries.length) {
          throw new Error('Not every GeoJSON geometry was inserted');
        }
        if (statisticsResult.rowCount < plan.cities.length) {
          throw new Error('Not every city statistic was updated');
        }
        operation.onProgress?.({
          phase: 'database',
          cities: plan.cities.length,
          geometries: plan.geometries.length,
          lineTypes: [...new Set(plan.geometries.map((geometry) => geometry.lineType))],
        });
        throwIfAdminTaskCancelled(operation.signal);

        operation.onCommit?.();
        await client.query('COMMIT');
        return {
          cities: plan.cities.length,
          geometries: plan.geometries.length,
          lineTypes: [...new Set(plan.geometries.map((geometry) => geometry.lineType))],
          ignoredFeatures: plan.ignoredFeatures.length,
          updatedAt: new Date().toISOString(),
        };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
