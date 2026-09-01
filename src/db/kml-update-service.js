import crypto from 'node:crypto';
import { throwIfAdminTaskCancelled } from '../data/admin-task-manager.js';
import { downloadKml } from '../data/kml-downloader.js';
import { parseKmlSource } from '../data/kml-parser.js';
import {
  KmlUpdateValidationError,
  resolveKmlUpdateRequest,
} from '../data/kml-update-options.js';
import { RECALCULATE_CITY_STATISTICS_SQL } from './recalculate-city-statistics.js';

export class KmlUpdateMatchError extends Error {
  constructor(message) {
    super(message);
    this.name = 'KmlUpdateMatchError';
  }
}

const CREATE_MATCH_GEOMETRIES_SQL = `
  CREATE TEMP TABLE kml_place_match_geometries ON COMMIT DROP AS
  SELECT
    id AS boundary_id,
    city_id,
    osm_name,
    place_type,
    osm_type,
    CASE
      WHEN $1::double precision = 0 THEN geom
      ELSE ST_Multi(
        ST_CollectionExtract(
          ST_Buffer(geom::geography, $1::double precision)::geometry,
          3
        )
      )
    END AS geom
  FROM city_boundaries
`;

const INDEX_MATCH_GEOMETRIES_SQL = `
  CREATE INDEX kml_place_match_geometries_geom_idx
    ON kml_place_match_geometries USING GIST (geom);
  ANALYZE kml_place_match_geometries
`;

const MATCH_GEOMETRIES_SQL = `
  WITH payload_rows AS (
    SELECT *
    FROM jsonb_to_recordset($1::jsonb) AS payload(
      "inputIndex" integer,
      geometry jsonb
    )
  ),
  prepared AS (
    SELECT
      payload_rows."inputIndex",
      ST_SetSRID(
        ST_GeomFromGeoJSON(payload_rows.geometry::text),
        4326
      ) AS geom
    FROM payload_rows
  )
  SELECT
    prepared."inputIndex" AS "inputIndex",
    candidate.boundary_id AS "boundaryId",
    candidate.city_id AS "cityId",
    candidate.city_name AS "cityName",
    candidate.place_name AS "placeName",
    candidate.place_type AS "placeType",
    COALESCE(candidate.candidate_count, 0)::integer AS "candidateCount"
  FROM prepared
  LEFT JOIN LATERAL (
    SELECT
      boundary.boundary_id,
      boundary.city_id,
      city.name AS city_name,
      boundary.osm_name AS place_name,
      boundary.place_type,
      count(*) OVER ()::integer AS candidate_count
    FROM kml_place_match_geometries AS boundary
    LEFT JOIN cities AS city ON city.id = boundary.city_id
    CROSS JOIN LATERAL (
      SELECT ST_CollectionExtract(
        ST_Intersection(prepared.geom, boundary.geom),
        2
      ) AS overlap
    ) AS intersection
    WHERE prepared.geom && boundary.geom
      AND ST_Intersects(prepared.geom, boundary.geom)
      AND ST_Length(intersection.overlap::geography) > 0
    ORDER BY
      ST_Length(intersection.overlap::geography) DESC,
      (boundary.city_id IS NOT NULL) DESC,
      ST_Area(boundary.geom::geography) ASC,
      (boundary.osm_type = 'relation') DESC,
      boundary.boundary_id ASC
    LIMIT 1
  ) AS candidate ON TRUE
  ORDER BY prepared."inputIndex"
`;

const INSERT_GEOMETRIES_SQL = `
  WITH payload_rows AS (
    SELECT *
    FROM jsonb_to_recordset($1::jsonb) AS payload(
      "cityId" bigint,
      "boundaryId" bigint,
      multiple smallint,
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
    lanes,
    length_m,
    lane_length_m,
    properties,
    geom
  )
  SELECT
    prepared."cityId",
    prepared."boundaryId",
    prepared.multiple,
    ST_Length(prepared.geom::geography),
    ST_Length(prepared.geom::geography) * prepared.multiple,
    prepared.properties,
    prepared.geom
  FROM prepared
`;

const INSERT_UPDATE_RUN_SQL = `
  INSERT INTO geometry_update_runs (
    sources,
    checksum,
    downloaded_bytes,
    parsed_lines,
    imported_geometries,
    skipped_without_city,
    resolved_ambiguous,
    ignored_non_lines,
    city_buffer_m
  )
  VALUES ($1::jsonb, $2, $3, $4, $5, $6, $7, $8, $9)
  RETURNING id::integer AS id, created_at AS "createdAt"
`;

/** @param {Array<any>} features */
function removeDuplicateFeatures(features) {
  const byFingerprint = new Map();
  const unique = [];
  let duplicates = 0;
  for (const feature of features) {
    const previous = byFingerprint.get(feature.fingerprint);
    if (!previous) {
      byFingerprint.set(feature.fingerprint, feature);
      unique.push(feature);
      continue;
    }
    if (previous.multiple !== feature.multiple) {
      throw new KmlUpdateValidationError(
        `The same KML geometry has conflicting multiple values: ${feature.fingerprint}`,
      );
    }
    duplicates += 1;
  }
  return { features: unique, duplicates };
}

/**
 * @param {{ connect: () => Promise<any> }} pool
 * @param {any} config
 * @param {{ download?: typeof downloadKml, parse?: typeof parseKmlSource }} [dependencies]
 */
export function createKmlUpdateService(pool, config, dependencies = {}) {
  const download = dependencies.download ?? downloadKml;
  const parse = dependencies.parse ?? parseKmlSource;

  return {
    /**
     * @param {unknown} body
     * @param {Record<string, unknown>} query
     * @param {{ signal?: AbortSignal, onProgress?: (progress: object) => void, onCommit?: () => void }} operation
     */
    async update(body, query = {}, operation = {}) {
      throwIfAdminTaskCancelled(operation.signal);
      const options = resolveKmlUpdateRequest(body, query, config);
      const allFeatures = [];
      const sourceResults = [];
      const checksum = crypto.createHash('sha256');
      let downloadedBytes = 0;
      let selectedPlacemarks = 0;
      let ignoredNonLines = 0;

      for (const [sourceIndex, source] of options.sources.entries()) {
        throwIfAdminTaskCancelled(operation.signal);
        const downloaded = await download(source, {
          allowedHosts: config.allowedHosts,
          timeoutMs: options.timeoutMs,
          maxFileBytes: options.maxFileBytes,
          signal: operation.signal,
        });
        throwIfAdminTaskCancelled(operation.signal);
        downloadedBytes += downloaded.bytes;
        if (downloadedBytes > options.maxTotalBytes) {
          throw new KmlUpdateValidationError(
            'Downloaded KML files exceed the configured total size limit',
          );
        }
        checksum.update(downloaded.xml);
        const parsed = parse(downloaded.xml, source);
        allFeatures.push(...parsed.features);
        selectedPlacemarks += parsed.selectedPlacemarks;
        ignoredNonLines += parsed.ignoredNonLines;
        sourceResults.push({
          URL: source.URL,
          finalURL: downloaded.finalURL,
          documentName: parsed.documentName,
          layers: source.layers,
          bytes: downloaded.bytes,
          lines: parsed.features.length,
          ignoredNonLines: parsed.ignoredNonLines,
        });
        operation.onProgress?.({
          phase: 'kml-source',
          source: sourceIndex + 1,
          sourceCount: options.sources.length,
          lines: parsed.features.length,
          bytes: downloaded.bytes,
          downloadedBytes,
        });
      }

      if (allFeatures.length === 0) {
        throw new KmlUpdateValidationError('Selected KML layers contain no lines');
      }
      const deduplicated = removeDuplicateFeatures(allFeatures);
      const features = deduplicated.features;
      const matchPayload = features.map((feature, inputIndex) => ({
        inputIndex,
        geometry: feature.geometry,
      }));

      const client = await pool.connect();
      try {
        throwIfAdminTaskCancelled(operation.signal);
        await client.query('BEGIN');
        await client.query(
          `SELECT pg_advisory_xact_lock(hashtext('dtpstat-buslines:data-import'))`,
        );
        throwIfAdminTaskCancelled(operation.signal);
        const boundaryResult = await client.query(
          'SELECT EXISTS (SELECT 1 FROM city_boundaries) AS ready',
        );
        if (!boundaryResult.rows[0]?.ready) {
          throw new KmlUpdateMatchError(
            'OSM place boundaries are empty; run POST /api/admin/update/cities first',
          );
        }
        await client.query(CREATE_MATCH_GEOMETRIES_SQL, [
          options.cityBufferMeters,
        ]);
        await client.query(INDEX_MATCH_GEOMETRIES_SQL);
        const matchResult = await client.query(MATCH_GEOMETRIES_SQL, [
          JSON.stringify(matchPayload),
        ]);
        if (matchResult.rows.length !== features.length) {
          throw new Error('Not every KML geometry was evaluated against OSM polygons');
        }

        const unmatched = matchResult.rows.filter((row) => row.boundaryId === null);
        const ambiguous = matchResult.rows.filter(
          (row) => row.candidateCount > 1,
        );
        if (unmatched.length > 0 && options.unmatchedPolicy === 'fail') {
          throw new KmlUpdateMatchError(
            `${unmatched.length} KML geometries do not overlap an OSM place polygon`,
          );
        }
        if (ambiguous.length > 0 && options.ambiguousPolicy === 'fail') {
          throw new KmlUpdateMatchError(
            `${ambiguous.length} KML geometries overlap multiple OSM place polygons`,
          );
        }

        const matched = matchResult.rows
          .filter((row) => row.boundaryId !== null)
          .map((row) => ({
            cityId: row.cityId,
            boundaryId: row.boundaryId,
            multiple: features[row.inputIndex].multiple,
            properties: features[row.inputIndex].properties,
            geometry: features[row.inputIndex].geometry,
          }));
        if (matched.length === 0) {
          throw new KmlUpdateMatchError('No KML geometries overlap an OSM place polygon');
        }

        const citiesUpdated = new Set(
          matched.map((row) => row.cityId).filter((cityId) => cityId !== null),
        ).size;
        const placesUpdated = new Set(matched.map((row) => row.boundaryId)).size;
        operation.onProgress?.({
          phase: 'database',
          matched: matched.length,
          unmatched: unmatched.length,
          ambiguous: ambiguous.length,
          citiesUpdated,
          placesUpdated,
        });
        throwIfAdminTaskCancelled(operation.signal);
        const completedAt = new Date().toISOString();
        const result = {
          dryRun: options.dryRun,
          sources: sourceResults,
          downloadedBytes,
          selectedPlacemarks,
          parsedLines: allFeatures.length,
          duplicates: deduplicated.duplicates,
          ignoredNonLines,
          cityBufferMeters: options.cityBufferMeters,
          importedGeometries: matched.length,
          skippedWithoutCity: unmatched.length,
          skippedWithoutPlace: unmatched.length,
          resolvedAmbiguous: ambiguous.length,
          citiesUpdated,
          placesUpdated,
          checksum: checksum.digest('hex'),
          completedAt,
          skipped: unmatched.slice(0, 50).map((row) => {
            const feature = features[row.inputIndex];
            return {
              fingerprint: feature.fingerprint,
              sourceURL: feature.properties.sourceURL,
              layer: feature.properties.layer,
              placemarkName: feature.properties.placemarkName,
            };
          }),
        };

        if (options.dryRun) {
          await client.query('ROLLBACK');
          return result;
        }

        await client.query('DELETE FROM city_geometries');
        const insertResult = await client.query(INSERT_GEOMETRIES_SQL, [
          JSON.stringify(matched),
        ]);
        if (insertResult.rowCount !== matched.length) {
          throw new Error('Not every matched KML geometry was inserted');
        }
        await client.query(RECALCULATE_CITY_STATISTICS_SQL);
        throwIfAdminTaskCancelled(operation.signal);
        const runResult = await client.query(INSERT_UPDATE_RUN_SQL, [
          JSON.stringify(sourceResults),
          result.checksum,
          downloadedBytes,
          allFeatures.length,
          matched.length,
          unmatched.length,
          ambiguous.length,
          ignoredNonLines,
          options.cityBufferMeters,
        ]);
        throwIfAdminTaskCancelled(operation.signal);
        operation.onCommit?.();
        await client.query('COMMIT');
        return {
          ...result,
          updateRunId: runResult.rows[0].id,
          completedAt: runResult.rows[0].createdAt,
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
