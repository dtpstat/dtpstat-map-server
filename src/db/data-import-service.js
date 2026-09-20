import {
  buildGeoJsonPlan,
  createGeoJsonAccumulator,
  GeoJsonValidationError,
} from '../data/geojson-plan.js';
import { parseStreamingJsonObject } from '../data/streaming-json.js';
import { throwIfAdminTaskCancelled } from '../data/admin-task-manager.js';
import { acquireDataImportLock } from './database-locks.js';
import { RECALCULATE_CITY_STATISTICS_SQL } from './recalculate-city-statistics.js';

const UPSERT_CITIES_SQL = `
  INSERT INTO cities (slug, name, full_name, lane_length_m, attributes)
  SELECT payload.slug, payload.name, payload."fullName", 0, payload.attributes
  FROM jsonb_to_recordset($1::jsonb) AS payload(
    slug text,
    name text,
    "fullName" text,
    attributes jsonb
  )
  ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    full_name = EXCLUDED.full_name,
    attributes = cities.attributes || EXCLUDED.attributes,
    updated_at = now()
`;

const UPDATE_LINE_TYPES_SQL = `
  WITH payload AS (
    SELECT *
    FROM jsonb_to_recordset($1::jsonb) AS item(
      code integer,
      name text,
      title text,
      color text,
      style text,
      width double precision
    )
  )
  UPDATE line_types AS line_type
  SET title = payload.title,
      color = payload.color,
      line_style = payload.style,
      width = payload.width,
      updated_at = now()
  FROM payload
  WHERE LOWER(BTRIM(line_type.name)) = LOWER(BTRIM(payload.name))
`;

const INSERT_MISSING_LINE_TYPES_SQL = `
  WITH payload AS (
    SELECT *
    FROM jsonb_to_recordset($1::jsonb) AS item(
      code integer,
      name text,
      title text,
      color text,
      style text,
      width double precision
    )
  )
  INSERT INTO line_types (name, title, color, line_style, width)
  SELECT payload.name, payload.title, payload.color, payload.style, payload.width
  FROM payload
  WHERE NOT EXISTS (
    SELECT 1
    FROM line_types AS existing
    WHERE LOWER(BTRIM(existing.name)) = LOWER(BTRIM(payload.name))
  )
  ON CONFLICT DO NOTHING
`;

const DELETE_OMITTED_LINE_TYPES_SQL = `
  WITH payload AS (
    SELECT name
    FROM jsonb_to_recordset($1::jsonb) AS item(name text)
  )
  DELETE FROM line_types AS line_type
  WHERE line_type.code <> 0
    AND NOT EXISTS (
      SELECT 1
      FROM payload
      WHERE LOWER(BTRIM(payload.name)) = LOWER(BTRIM(line_type.name))
    )
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
   AND boundary.is_active
  WHERE payload."boundaryOsmId" IS NOT NULL
    AND boundary.id IS NULL
  ORDER BY osm_type, osm_id
`;

const FIND_UNKNOWN_LINE_TYPES_SQL = `
  SELECT DISTINCT payload."lineTypeName" AS line_type_name
  FROM jsonb_to_recordset($1::jsonb) AS payload("lineTypeName" text)
  LEFT JOIN line_types AS line_type
    ON LOWER(BTRIM(line_type.name)) = LOWER(BTRIM(payload."lineTypeName"))
  WHERE line_type.id IS NULL
  ORDER BY payload."lineTypeName"
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
   AND boundary.is_active
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
    AND boundary.is_active
    AND boundary.city_id IS NULL
`;

const STREAM_STAGE_BATCH_SIZE = 50;

const CREATE_STREAM_RAW_SQL = `
  CREATE TEMP TABLE line_transfer_raw (
    seq bigint PRIMARY KEY,
    item jsonb NOT NULL
  ) ON COMMIT DROP
`;

const INSERT_STREAM_RAW_SQL = `
  INSERT INTO line_transfer_raw (seq, item)
  SELECT payload.seq, payload.item
  FROM jsonb_to_recordset($1::jsonb) AS payload(
    seq bigint,
    item jsonb
  )
`;

const CREATE_STREAM_STAGE_SQL = `
  CREATE TEMP TABLE line_transfer_stage (
    seq bigint PRIMARY KEY,
    city_name text,
    city_slug text,
    boundary_osm_type text,
    boundary_osm_id bigint,
    line_type_name text NOT NULL,
    lanes smallint NOT NULL,
    properties jsonb NOT NULL,
    geom geometry(Geometry, 4326) NOT NULL
  ) ON COMMIT DROP
`;

const INSERT_STREAM_STAGE_SQL = `
  WITH payload_rows AS (
    SELECT *
    FROM jsonb_to_recordset($1::jsonb) AS payload(
      seq bigint,
      "cityName" text,
      "citySlug" text,
      "boundaryOsmType" text,
      "boundaryOsmId" bigint,
      "lineTypeName" text,
      lanes smallint,
      properties jsonb,
      geometry jsonb
    )
  )
  INSERT INTO line_transfer_stage (
    seq,
    city_name,
    city_slug,
    boundary_osm_type,
    boundary_osm_id,
    line_type_name,
    lanes,
    properties,
    geom
  )
  SELECT
    seq,
    "cityName",
    "citySlug",
    "boundaryOsmType",
    "boundaryOsmId",
    "lineTypeName",
    lanes,
    properties,
    ST_SetSRID(ST_GeomFromGeoJSON(geometry::text), 4326)
  FROM payload_rows
`;

const FIND_STREAM_UNKNOWN_BOUNDARIES_SQL = `
  SELECT DISTINCT
    stage.boundary_osm_type AS osm_type,
    stage.boundary_osm_id AS osm_id
  FROM line_transfer_stage AS stage
  LEFT JOIN city_boundaries AS boundary
    ON boundary.osm_type = stage.boundary_osm_type
   AND boundary.osm_id = stage.boundary_osm_id
   AND boundary.is_active
  WHERE stage.boundary_osm_id IS NOT NULL
    AND boundary.id IS NULL
  ORDER BY osm_type, osm_id
`;

const FIND_STREAM_BOUNDARY_CITY_CONFLICTS_SQL = `
  SELECT DISTINCT
    boundary.osm_type,
    boundary.osm_id,
    boundary.city_id AS existing_city_id,
    city.id AS imported_city_id
  FROM line_transfer_stage AS stage
  JOIN city_boundaries AS boundary
    ON boundary.osm_type = stage.boundary_osm_type
   AND boundary.osm_id = stage.boundary_osm_id
   AND boundary.is_active
  JOIN cities AS city ON city.slug = stage.city_slug
  WHERE boundary.city_id IS NOT NULL
    AND boundary.city_id <> city.id
  ORDER BY boundary.osm_type, boundary.osm_id
`;

const LINK_STREAM_BOUNDARIES_SQL = `
  UPDATE city_boundaries AS boundary
  SET city_id = city.id,
      updated_at = now()
  FROM (
    SELECT DISTINCT city_slug, boundary_osm_type, boundary_osm_id
    FROM line_transfer_stage
    WHERE city_slug IS NOT NULL
      AND boundary_osm_id IS NOT NULL
  ) AS stage
  JOIN cities AS city ON city.slug = stage.city_slug
  WHERE boundary.osm_type = stage.boundary_osm_type
    AND boundary.osm_id = stage.boundary_osm_id
    AND boundary.is_active
    AND boundary.city_id IS NULL
`;

const FIND_STREAM_UNKNOWN_LINE_TYPES_SQL = `
  SELECT DISTINCT stage.line_type_name
  FROM line_transfer_stage AS stage
  LEFT JOIN line_types AS line_type
    ON LOWER(BTRIM(line_type.name)) = LOWER(BTRIM(stage.line_type_name))
  WHERE line_type.id IS NULL
  ORDER BY stage.line_type_name
`;

const INSERT_STREAM_GEOMETRIES_SQL = `
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
    stage.lanes,
    ST_Length(stage.geom::geography),
    ST_Length(stage.geom::geography) * stage.lanes,
    stage.properties,
    stage.geom
  FROM line_transfer_stage AS stage
  JOIN line_types AS line_type
    ON LOWER(BTRIM(line_type.name)) = LOWER(BTRIM(stage.line_type_name))
  LEFT JOIN cities AS city ON city.slug = stage.city_slug
  LEFT JOIN city_boundaries AS boundary
    ON boundary.osm_type = stage.boundary_osm_type
   AND boundary.osm_id = stage.boundary_osm_id
   AND boundary.is_active
  ORDER BY stage.seq
`;

const INSERT_GEOMETRIES_SQL = `
  WITH payload_rows AS (
    SELECT *
    FROM jsonb_to_recordset($1::jsonb) AS payload(
      "cityName" text,
      "citySlug" text,
      "boundaryOsmType" text,
      "boundaryOsmId" bigint,
      "lineTypeName" text,
      lanes smallint,
      properties jsonb,
      geometry jsonb
    )
  ),
  prepared AS (
    SELECT
      payload_rows.*,
      ST_SetSRID(ST_GeomFromGeoJSON(payload_rows.geometry::text), 4326) AS geom
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
  JOIN line_types AS line_type
    ON LOWER(BTRIM(line_type.name)) = LOWER(BTRIM(prepared."lineTypeName"))
  LEFT JOIN cities AS city ON city.slug = prepared."citySlug"
  LEFT JOIN city_boundaries AS boundary
    ON boundary.osm_type = prepared."boundaryOsmType"
   AND boundary.osm_id = prepared."boundaryOsmId"
   AND boundary.is_active
`;

/** @param {{ connect: () => Promise<any>, databaseSchema?: string }} pool */
export function createDataImportService(pool) {
  return {
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
        await acquireDataImportLock(client, pool);
        throwIfAdminTaskCancelled(operation.signal);

        await client.query(UPSERT_CITIES_SQL, [JSON.stringify(plan.cities)]);
        const serializedGeometries = JSON.stringify(plan.geometries);

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
            `Line GeoJSON references unknown or inactive city boundaries: ${objects}. Import/activate the OSM boundary snapshot first.`,
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
        if (plan.lineTypes.length > 0) {
          const dictionary = JSON.stringify(plan.lineTypes);
          await client.query(DELETE_OMITTED_LINE_TYPES_SQL, [dictionary]);
          await client.query(UPDATE_LINE_TYPES_SQL, [dictionary]);
          await client.query(INSERT_MISSING_LINE_TYPES_SQL, [dictionary]);
        }

        const unknownLineTypes = await client.query(
          FIND_UNKNOWN_LINE_TYPES_SQL,
          [serializedGeometries],
        );
        if (unknownLineTypes.rows.length > 0) {
          throw new GeoJsonValidationError(
            `Line GeoJSON references unknown line type names: ${unknownLineTypes.rows.map((row) => row.line_type_name).join(', ')}`,
          );
        }

        const geometryResult = await client.query(INSERT_GEOMETRIES_SQL, [serializedGeometries]);
        const statisticsResult = await client.query(RECALCULATE_CITY_STATISTICS_SQL);

        if (geometryResult.rowCount !== plan.geometries.length) {
          throw new Error('Not every GeoJSON geometry was inserted');
        }
        if (statisticsResult.rowCount < plan.cities.length) {
          throw new Error('Not every city statistic was updated');
        }

        const referencedLineTypes = [
          ...new Set(plan.geometries.map((geometry) => geometry.lineTypeName)),
        ];
        operation.onProgress?.({
          phase: 'database',
          cities: plan.cities.length,
          geometries: plan.geometries.length,
          lineTypes: referencedLineTypes,
        });
        throwIfAdminTaskCancelled(operation.signal);

        operation.onCommit?.();
        await client.query('COMMIT');
        return {
          cities: plan.cities.length,
          geometries: plan.geometries.length,
          lineTypes: referencedLineTypes,
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