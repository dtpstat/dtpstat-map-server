import { throwIfAdminTaskCancelled } from '../data/admin-task-manager.js';
import {
  buildCityBoundaryGeoJsonPlan,
  createCityBoundaryGeoJsonAccumulator,
} from '../data/city-boundary-geojson-plan.js';
import { parseStreamingJsonObject } from '../data/streaming-json.js';
import { acquireDataImportLock } from './database-locks.js';
import { RECALCULATE_CITY_STATISTICS_SQL } from './recalculate-city-statistics.js';

// Keep each PostgreSQL jsonb/PostGIS conversion request bounded. The portable
// city snapshot can contain thousands of detailed MultiPolygons; sending the
// whole snapshot through one jsonb_to_recordset call creates an avoidable
// backend memory spike.
const STAGE_BATCH_SIZE = 50;

const UPSERT_CITIES_SQL = `
  INSERT INTO cities (
    slug,
    name,
    full_name,
    display_type,
    lane_length_m,
    attributes
  )
  SELECT
    payload.slug,
    payload.name,
    payload."fullName",
    payload."displayType",
    0,
    payload.attributes
  FROM jsonb_to_recordset($1::jsonb) AS payload(
    slug text,
    name text,
    "fullName" text,
    "displayType" text,
    attributes jsonb
  )
  ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    full_name = EXCLUDED.full_name,
    display_type = EXCLUDED.display_type,
    attributes = EXCLUDED.attributes,
    updated_at = now()
`;

const CREATE_STAGE_SQL = `
  CREATE TEMP TABLE city_boundary_transfer_stage (
    place_type text,
    admin_level smallint,
    active boolean NOT NULL,
    display_name text NOT NULL,
    display_type text NOT NULL,
    osm_type text NOT NULL,
    osm_id bigint NOT NULL,
    osm_name text NOT NULL,
    tags jsonb NOT NULL,
    osm_timestamp timestamptz,
    updated_at timestamptz,
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
      "adminLevel" smallint,
      active boolean,
      "displayName" text,
      "displayType" text,
      "osmType" text,
      "osmId" bigint,
      "osmName" text,
      tags jsonb,
      "osmTimestamp" timestamptz,
      "updatedAt" timestamptz,
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
    admin_level,
    active,
    display_name,
    display_type,
    osm_type,
    osm_id,
    osm_name,
    tags,
    osm_timestamp,
    updated_at,
    city_slug,
    city_name,
    geom,
    bounds
  )
  SELECT
    "placeType",
    "adminLevel",
    active,
    "displayName",
    "displayType",
    "osmType",
    "osmId",
    "osmName",
    tags,
    "osmTimestamp",
    "updatedAt",
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
    admin_level,
    osm_type,
    osm_id,
    osm_name,
    tags,
    geom,
    bounds,
    osm_timestamp,
    updated_at,
    is_active,
    display_name,
    display_type,
    area_m2
  )
  SELECT
    COALESCE(
      (SELECT city.id FROM cities AS city WHERE city.slug = stage.city_slug LIMIT 1),
      (
        SELECT MIN(city.id)
        FROM cities AS city
        WHERE city.name = stage.city_name
        HAVING COUNT(*) = 1
      )
    ),
    stage.place_type,
    stage.admin_level,
    stage.osm_type,
    stage.osm_id,
    stage.osm_name,
    stage.tags,
    stage.geom,
    stage.bounds,
    stage.osm_timestamp,
    COALESCE(stage.updated_at, now()),
    stage.active,
    stage.display_name,
    stage.display_type,
    ST_Area(stage.geom::geography)
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

/** @param {unknown} error */
function errorDetails(error) {
  return {
    name: error instanceof Error ? error.name : 'Error',
    code: error?.code ?? null,
    message: error instanceof Error ? error.message : String(error),
  };
}

/**
 * Atomically replace the complete OSM city/town boundary snapshot from a
 * portable GeoJSON export. Existing line-to-boundary links survive when the
 * same OSM object exists in the imported snapshot. Linked ranked-city records
 * restore their portable attributes but all derived statistics remain local
 * and are recalculated by line/population imports.
 *
 * @param {{ connect: () => Promise<any>, databaseSchema?: string }} pool
 */
export function createCityBoundaryTransferService(pool) {
  return {
    /**
     * Stream a portable city GeoJSON snapshot into PostgreSQL staging while one
     * transaction is open. Only one feature batch is materialized in JS at a
     * time; any parser/ZIP/PostGIS error rolls the complete transaction back.
     *
     * @param {AsyncIterable<Buffer | Uint8Array | string>} source
     * @param {{
     *   dryRun?: boolean,
     *   maxJsonBytes: number,
     *   maxItemBytes: number,
     *   signal?: AbortSignal,
     *   onProgress?: (progress: object) => void,
     *   onCommit?: () => void
     * }} operation
     */
    async replaceFromGeoJsonStream(source, operation = {}) {
      throwIfAdminTaskCancelled(operation.signal);
      const client = await pool.connect();
      let discardClientError;
      try {
        await client.query('BEGIN');
        await acquireDataImportLock(client, pool);
        if (!operation.dryRun) {
          await client.query('SELECT assert_no_pending_geometry_import()');
        }
        throwIfAdminTaskCancelled(operation.signal);
        await client.query(CREATE_STAGE_SQL);

        const accumulator = createCityBoundaryGeoJsonAccumulator();
        let stagedPlaces = 0;
        let batchNumber = 0;
        let batch = [];

        const flush = async () => {
          if (batch.length === 0) return;
          const payload = JSON.stringify(batch);
          const stageResult = await client.query(INSERT_STAGE_SQL, [payload]);
          if (stageResult.rowCount !== batch.length) {
            throw new Error('Not every city boundary was staged');
          }
          stagedPlaces += stageResult.rowCount;
          batchNumber += 1;
          operation.onProgress?.({
            phase: 'stage',
            batch: batchNumber,
            batchPlaces: batch.length,
            stagedPlaces,
            payloadBytes: Buffer.byteLength(payload),
          });
          batch = [];
        };

        const parsed = await parseStreamingJsonObject(source, {
          arrayKey: 'features',
          metadataKeys: new Set([
            'type',
            'name',
            'schemaVersion',
            'exportedAt',
          ]),
          maxBytes: operation.maxJsonBytes,
          maxItemBytes: operation.maxItemBytes,
          maxDepth: operation.maxJsonDepth,
          maxItems: operation.maxJsonItems,
          signal: operation.signal,
          async onItem(feature, featureIndex) {
            throwIfAdminTaskCancelled(operation.signal);
            batch.push(accumulator.addFeature(feature, featureIndex));
            if (batch.length >= STAGE_BATCH_SIZE) await flush();
          },
          onProgress(progress) {
            operation.onProgress?.({
              ...progress,
              dataSet: 'cities',
            });
          },
        });
        await flush();

        const plan = accumulator.finish(parsed.metadata);
        if (
          stagedPlaces !== parsed.itemCount ||
          stagedPlaces !== plan.boundaryCount
        ) {
          throw new Error('Not every streamed city boundary was staged');
        }
        operation.onProgress?.({
          phase: 'validated',
          places: stagedPlaces,
          cities: plan.cities.length,
          decodedBytes: parsed.decodedBytes,
        });

        if (plan.cities.length > 0) {
          const cityResult = await client.query(UPSERT_CITIES_SQL, [
            JSON.stringify(plan.cities),
          ]);
          if (cityResult.rowCount !== plan.cities.length) {
            throw new Error('Not every linked city record was imported');
          }
        }

        operation.onProgress?.({
          phase: 'validate-stage',
          places: stagedPlaces,
        });
        const invalidResult = await client.query(INVALID_STAGE_SQL);
        if (invalidResult.rows.length > 0) {
          const names = invalidResult.rows
            .slice(0, 20)
            .map((row) => `${row.osm_type}/${row.osm_id} ${row.osm_name}`)
            .join(', ');
          throw new Error(
            `Imported city boundaries contain invalid polygons: ${names}`,
          );
        }

        operation.onProgress?.({ phase: 'preserve-links' });
        await client.query(PRESERVE_GEOMETRY_LINKS_SQL);
        operation.onProgress?.({ phase: 'replace-boundaries' });
        await client.query('DELETE FROM city_boundaries');
        const inserted = await client.query(INSERT_BOUNDARIES_SQL);
        if (inserted.rowCount !== stagedPlaces) {
          throw new Error('Not every city boundary was imported');
        }

        await client.query('SELECT rebuild_city_boundary_hierarchy()');
        const restored = await client.query(RESTORE_GEOMETRY_LINKS_SQL);
        await client.query('SELECT sync_active_boundary_cities()');
        await client.query('SELECT assert_city_geometry_invariants()');
        await client.query(RECALCULATE_CITY_STATISTICS_SQL);
        throwIfAdminTaskCancelled(operation.signal);

        const linkedResult = await client.query(`
          SELECT count(*)::integer AS count
          FROM city_boundaries
          WHERE city_id IS NOT NULL
        `);
        const result = {
          dryRun: Boolean(operation.dryRun),
          importedPlaces: stagedPlaces,
          importedCities: plan.cities.length,
          linkedCities: linkedResult.rows[0]?.count ?? 0,
          restoredGeometryLinks: restored.rowCount,
          decodedBytes: parsed.decodedBytes,
          streamed: true,
          completedAt: new Date().toISOString(),
        };
        operation.onProgress?.({
          phase: 'database',
          places: result.importedPlaces,
          cities: result.importedCities,
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
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          discardClientError = rollbackError;
          operation.onProgress?.({
            phase: 'rollback-failed',
            error: errorDetails(rollbackError),
          });
        }
        throw error;
      } finally {
        client.release(discardClientError);
      }
    },

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
        cities: plan.cities.length,
      });
      const client = await pool.connect();
      let discardClientError;
      try {
        await client.query('BEGIN');
        await acquireDataImportLock(client, pool);
        if (!operation.dryRun) {
          await client.query('SELECT assert_no_pending_geometry_import()');
        }
        throwIfAdminTaskCancelled(operation.signal);

        if (plan.cities.length > 0) {
          const cityResult = await client.query(UPSERT_CITIES_SQL, [
            JSON.stringify(plan.cities),
          ]);
          if (cityResult.rowCount !== plan.cities.length) {
            throw new Error('Not every linked city record was imported');
          }
        }
        operation.onProgress?.({
          phase: 'cities',
          cities: plan.cities.length,
        });

        await client.query(CREATE_STAGE_SQL);
        const batchCount = Math.ceil(plan.boundaries.length / STAGE_BATCH_SIZE);
        let stagedPlaces = 0;
        for (let offset = 0; offset < plan.boundaries.length; offset += STAGE_BATCH_SIZE) {
          throwIfAdminTaskCancelled(operation.signal);
          const batch = plan.boundaries.slice(offset, offset + STAGE_BATCH_SIZE);
          const payload = JSON.stringify(batch);
          const stageResult = await client.query(INSERT_STAGE_SQL, [payload]);
          if (stageResult.rowCount !== batch.length) {
            throw new Error('Not every city boundary was staged');
          }
          stagedPlaces += stageResult.rowCount;
          operation.onProgress?.({
            phase: 'stage',
            batch: Math.floor(offset / STAGE_BATCH_SIZE) + 1,
            batchCount,
            batchPlaces: batch.length,
            stagedPlaces,
            places: plan.boundaries.length,
            payloadBytes: Buffer.byteLength(payload),
          });
        }
        if (stagedPlaces !== plan.boundaries.length) {
          throw new Error('Not every city boundary was staged');
        }

        operation.onProgress?.({
          phase: 'validate-stage',
          places: stagedPlaces,
        });
        const invalidResult = await client.query(INVALID_STAGE_SQL);
        if (invalidResult.rows.length > 0) {
          const names = invalidResult.rows
            .slice(0, 20)
            .map((row) => `${row.osm_type}/${row.osm_id} ${row.osm_name}`)
            .join(', ');
          throw new Error(`Imported city boundaries contain invalid polygons: ${names}`);
        }

        operation.onProgress?.({ phase: 'preserve-links' });
        await client.query(PRESERVE_GEOMETRY_LINKS_SQL);
        operation.onProgress?.({ phase: 'replace-boundaries' });
        await client.query('DELETE FROM city_boundaries');
        const inserted = await client.query(INSERT_BOUNDARIES_SQL);
        if (inserted.rowCount !== plan.boundaries.length) {
          throw new Error('Not every city boundary was imported');
        }
        operation.onProgress?.({
          phase: 'restore-links',
          places: inserted.rowCount,
        });
        await client.query('SELECT rebuild_city_boundary_hierarchy()');
        const restored = await client.query(RESTORE_GEOMETRY_LINKS_SQL);
        // Restore boundary_id first: synchronizing active boundaries may
        // reassign their application city and must update existing line rows
        // against the restored exact OSM object.
        await client.query('SELECT sync_active_boundary_cities()');
        await client.query('SELECT assert_city_geometry_invariants()');
        await client.query(RECALCULATE_CITY_STATISTICS_SQL);
        throwIfAdminTaskCancelled(operation.signal);

        const linkedResult = await client.query(`
          SELECT count(*)::integer AS count
          FROM city_boundaries
          WHERE city_id IS NOT NULL
        `);
        const result = {
          dryRun: Boolean(operation.dryRun),
          importedPlaces: plan.boundaries.length,
          importedCities: plan.cities.length,
          linkedCities: linkedResult.rows[0]?.count ?? 0,
          restoredGeometryLinks: restored.rowCount,
          completedAt: new Date().toISOString(),
        };
        operation.onProgress?.({
          phase: 'database',
          places: result.importedPlaces,
          cities: result.importedCities,
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
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          discardClientError = rollbackError;
          operation.onProgress?.({
            phase: 'rollback-failed',
            error: errorDetails(rollbackError),
          });
        }
        throw error;
      } finally {
        client.release(discardClientError);
      }
    },
  };
}
