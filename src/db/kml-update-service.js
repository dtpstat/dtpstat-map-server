import crypto from 'node:crypto';
import { throwIfAdminTaskCancelled } from '../data/admin-task-manager.js';
import { downloadKml } from '../data/kml-downloader.js';
import { parseKmlSource } from '../data/kml-parser.js';
import { comparableLineTypeName } from '../data/line-types.js';
import {
  KmlUpdateValidationError,
  resolveKmlUpdateRequest,
} from '../data/kml-update-options.js';
import { acquireDataImportLock } from './database-locks.js';
import { createGeometryImportRepository } from './geometry-import-repository.js';

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
    display_name,
    display_type,
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
  WHERE is_active
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
      boundary.city_id AS city_id,
      COALESCE(linked_city.name, boundary.display_name) AS city_name,
      boundary.display_name AS place_name,
      boundary.display_type AS place_type,
      count(*) OVER ()::integer AS candidate_count
    FROM kml_place_match_geometries AS boundary
    LEFT JOIN cities AS linked_city ON linked_city.id = boundary.city_id
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

const LOAD_LINE_TYPES_SQL = `
  WITH requested AS (
    SELECT DISTINCT BTRIM(name) AS name
    FROM unnest($1::text[]) AS requested(name)
  )
  SELECT
    requested.name AS "requestedName",
    line_type.id::integer AS id,
    line_type.code::integer AS code,
    line_type.name,
    line_type.title,
    line_type.color,
    line_type.line_style AS style,
    line_type.width::double precision AS width
  FROM requested
  JOIN line_types AS line_type
    ON LOWER(BTRIM(line_type.name)) = LOWER(BTRIM(requested.name))
  ORDER BY line_type.code
`;

function importedSourceTags(properties) {
  const tags = { ...(properties ?? {}) };
  delete tags.fingerprint;
  return tags;
}

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
    if (
      previous.multiple !== feature.multiple ||
      comparableLineTypeName(previous.businessTypeName) !==
        comparableLineTypeName(feature.businessTypeName)
    ) {
      throw new KmlUpdateValidationError(
        `The same KML geometry has conflicting multiple/type values: ${feature.fingerprint}`,
      );
    }
    duplicates += 1;
  }
  return { features: unique, duplicates };
}

/** @param {Array<any>} features */
function referencedTypeNames(features) {
  const names = new Map();
  for (const feature of features) {
    const key = comparableLineTypeName(feature.businessTypeName);
    if (!names.has(key)) names.set(key, feature.businessTypeName.trim().normalize('NFC'));
  }
  return [...names.values()].sort((left, right) => left.localeCompare(right, 'ru'));
}

/** @param {string[]} names @param {any[]} rows */
function missingTypeNames(names, rows) {
  const existing = new Set(rows.map((row) => comparableLineTypeName(row.name)));
  return names.filter((name) => !existing.has(comparableLineTypeName(name)));
}

/** @param {string[]} names */
function previewLineTypes(names) {
  return names.map((name) => ({
    id: null,
    code: null,
    name,
    title: name,
    color: '#045b69',
    style: 'solid',
    width: 4,
  }));
}

/** @param {any[]} rows */
function publicLineTypes(rows) {
  return rows.map(({ requestedName: _requestedName, ...lineType }) => lineType);
}

/**
 * @param {{ connect: () => Promise<any>, databaseSchema?: string }} pool
 * @param {any} config
 * @param {{
 *   download?: typeof downloadKml,
 *   parse?: typeof parseKmlSource,
 *   geometryImportRepository?: ReturnType<typeof createGeometryImportRepository>
 * }} [dependencies]
 */
export function createKmlUpdateService(pool, config, dependencies = {}) {
  const download = dependencies.download ?? downloadKml;
  const parse = dependencies.parse ?? parseKmlSource;
  const geometryImportRepository = dependencies.geometryImportRepository ??
    createGeometryImportRepository(pool);

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
      const referencedNames = referencedTypeNames(features);
      const matchPayload = features.map((feature, inputIndex) => ({
        inputIndex,
        geometry: feature.geometry,
      }));

      const client = await pool.connect();
      try {
        throwIfAdminTaskCancelled(operation.signal);
        await client.query('BEGIN');
        await acquireDataImportLock(client, pool);
        throwIfAdminTaskCancelled(operation.signal);

        let typeRows = (await client.query(
          LOAD_LINE_TYPES_SQL,
          [referencedNames],
        )).rows;
        const missingNames = missingTypeNames(referencedNames, typeRows);
        let createdLineTypes = [];
        const wouldCreateLineTypes = previewLineTypes(missingNames);

        // Missing line types remain previews until the staged import is
        // actually applied. A pending conflict must not modify dictionaries.
        typeRows = [...typeRows, ...wouldCreateLineTypes.map((lineType) => ({
          requestedName: lineType.name,
          ...lineType,
        }))];

        const typeByName = new Map(
          typeRows.map((lineType) => [
            comparableLineTypeName(lineType.requestedName ?? lineType.name),
            lineType,
          ]),
        );
        if (typeByName.size !== referencedNames.length) {
          throw new Error('Not every imported KML business type was resolved');
        }

        const boundaryResult = await client.query(
          'SELECT EXISTS (SELECT 1 FROM city_boundaries WHERE is_active) AS ready',
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
        const ambiguous = matchResult.rows.filter((row) => row.candidateCount > 1);
        if (unmatched.length > 0 && options.unmatchedPolicy === 'fail') {
          throw new KmlUpdateMatchError(
            `${unmatched.length} KML geometries do not overlap an imported OSM place polygon`,
          );
        }
        if (ambiguous.length > 0 && options.ambiguousPolicy === 'fail') {
          throw new KmlUpdateMatchError(
            `${ambiguous.length} KML geometries overlap multiple OSM place polygons`,
          );
        }

        const matchedRows = matchResult.rows.filter((row) => row.boundaryId !== null);
        if (matchedRows.length === 0) {
          throw new KmlUpdateMatchError(
            'No KML geometries overlap an imported OSM place polygon',
          );
        }

        const matched = matchedRows.map((row) => {
          const feature = features[row.inputIndex];
          const lineType = typeByName.get(
            comparableLineTypeName(feature.businessTypeName),
          );
          const cityName = row.cityName ?? row.placeName;
          const cityId = row.cityId === null ? null : Number(row.cityId);
          return {
            cityId,
            cityName,
            boundaryId: row.boundaryId,
            lineTypeId: lineType.id,
            businessTypeCode: lineType.code,
            businessTypeName: lineType.name,
            multiple: feature.multiple,
            properties: feature.properties,
            sourceTags: importedSourceTags(feature.properties),
            geometry: feature.geometry,
          };
        });

        const citiesUpdated = new Set(matched.map((row) => row.cityName)).size;
        const placesUpdated = new Set(matched.map((row) => row.boundaryId)).size;
        const reportedLineTypes = publicLineTypes(typeRows)
          .sort((left, right) => {
            if (left.code === null) return 1;
            if (right.code === null) return -1;
            return left.code - right.code;
          });

        operation.onProgress?.({
          phase: 'database',
          matched: matched.length,
          unmatched: unmatched.length,
          ambiguous: ambiguous.length,
          citiesUpdated,
          placesUpdated,
          lineTypes: reportedLineTypes,
          newLineTypes: options.dryRun
            ? wouldCreateLineTypes.map((lineType) => lineType.name)
            : createdLineTypes.map((lineType) => lineType.code),
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
          lineTypes: reportedLineTypes,
          createdLineTypes,
          wouldCreateLineTypes,
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
              businessTypeName: feature.businessTypeName,
            };
          }),
        };

        if (options.dryRun) {
          await client.query('ROLLBACK');
          return result;
        }

        const importSession = await geometryImportRepository.stageKml(
          client,
          matched,
          result,
        );
        throwIfAdminTaskCancelled(operation.signal);

        if (importSession.conflictCount > 0) {
          operation.onProgress?.({
            phase: 'import-conflicts',
            sessionId: importSession.id,
            conflictGeometries: importSession.conflictGeometries,
            conflictPairs: importSession.conflictCount,
          });
          operation.onCommit?.();
          await client.query('COMMIT');
          return {
            ...result,
            pendingResolution: true,
            importSession,
            createdLineTypes: [],
          };
        }

        const applied = await geometryImportRepository.applyInTransaction(
          client,
          importSession.id,
          [],
        );
        createdLineTypes = applied.createdLineTypes ?? [];
        typeRows = (await client.query(
          LOAD_LINE_TYPES_SQL,
          [referencedNames],
        )).rows;
        throwIfAdminTaskCancelled(operation.signal);
        operation.onCommit?.();
        await client.query('COMMIT');
        return {
          ...result,
          pendingResolution: false,
          importSession: {
            ...importSession,
            status: 'applied',
          },
          lineTypes: publicLineTypes(typeRows),
          createdLineTypes,
          wouldCreateLineTypes: [],
          updateRunId: applied.updateRunId,
          completedAt: applied.completedAt,
          reconciliation: applied,
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
