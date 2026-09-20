import crypto from 'node:crypto';
import { throwIfAdminTaskCancelled } from '../data/admin-task-manager.js';
import {
  downloadOsmCities,
  OsmCityDownloadError,
} from '../data/osm-city-downloader.js';
import {
  buildOsmPlacesBatchQuery,
  buildRussianPlaceIdOverpassQueries,
  parseOsmCityResponse,
  parseOsmPlaceIdsResponse,
} from '../data/osm-city-parser.js';
import {
  normalizeOsmUpdateUrl,
  OsmCityUpdateValidationError,
  resolveOsmCityUpdateRequest,
} from '../data/osm-city-update-options.js';
import { acquireDataImportLock } from './database-locks.js';
import { RECALCULATE_CITY_STATISTICS_SQL } from './recalculate-city-statistics.js';

const RETRYABLE_HTTP_STATUS_CODES = new Set([429, 502, 503, 504]);
const GEOMETRY_504_RETRIES_BEFORE_SPLIT = 3;

/** @param {number} milliseconds @param {AbortSignal | undefined} signal */
function abortableDelay(milliseconds, signal) {
  throwIfAdminTaskCancelled(signal);
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      try {
        throwIfAdminTaskCancelled(signal);
      } catch (error) {
        reject(error);
      }
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

const DROP_STAGE_SQL = 'DROP TABLE IF EXISTS osm_city_boundary_stage';

const CREATE_STAGE_SQL = `
  CREATE TEMP TABLE osm_city_boundary_stage (
    name text NOT NULL,
    place_type text,
    admin_level smallint,
    osm_type text NOT NULL,
    osm_id bigint NOT NULL,
    tags jsonb NOT NULL,
    geom geometry(MultiPolygon, 4326) NOT NULL,
    bounds geometry(Polygon, 4326) NOT NULL,
    PRIMARY KEY (osm_type, osm_id)
  ) ON COMMIT PRESERVE ROWS
`;

const PRESERVE_LINKS_SQL = `
  CREATE TEMP TABLE old_city_boundary_links ON COMMIT DROP AS
  SELECT
    osm_type,
    osm_id,
    city_id,
    is_active,
    display_name,
    display_type
  FROM city_boundaries;

  CREATE TEMP TABLE old_geometry_boundary_links ON COMMIT DROP AS
  SELECT geometry.id AS geometry_id, boundary.osm_type, boundary.osm_id
  FROM city_geometries AS geometry
  JOIN city_boundaries AS boundary ON boundary.id = geometry.boundary_id
`;

const INSERT_STAGE_SQL = `
  WITH payload_rows AS (
    SELECT *
    FROM jsonb_to_recordset($1::jsonb) AS payload(
      name text,
      "placeType" text,
      "adminLevel" smallint,
      "osmType" text,
      "osmId" bigint,
      tags jsonb,
      linework jsonb
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
  INSERT INTO osm_city_boundary_stage (
    name,
    place_type,
    admin_level,
    osm_type,
    osm_id,
    tags,
    geom,
    bounds
  )
  SELECT
    name,
    "placeType",
    "adminLevel",
    "osmType",
    "osmId",
    tags,
    geom,
    ST_Envelope(geom)
  FROM polygons
`;

const INVALID_STAGE_SQL = `
  SELECT name
  FROM osm_city_boundary_stage
  WHERE ST_IsEmpty(geom)
     OR NOT ST_IsValid(geom)
     OR ST_Area(geom::geography) <= 0
  ORDER BY name
`;

const COUNT_STAGE_SQL = `
  SELECT count(*)::integer AS count
  FROM osm_city_boundary_stage
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
    is_active,
    display_name,
    display_type,
    area_m2
  )
  SELECT
    old_link.city_id,
    stage.place_type,
    stage.admin_level,
    stage.osm_type,
    stage.osm_id,
    stage.name,
    stage.tags,
    stage.geom,
    stage.bounds,
    $1::timestamptz,
    COALESCE(old_link.is_active, FALSE),
    COALESCE(
      old_link.display_name,
      NULLIF(BTRIM(stage.tags ->> 'name:ru'), ''),
      stage.name
    ),
    COALESCE(
      old_link.display_type,
      stage.place_type,
      'administrative'
    ),
    ST_Area(stage.geom::geography)
  FROM osm_city_boundary_stage AS stage
  LEFT JOIN old_city_boundary_links AS old_link
    ON old_link.osm_type = stage.osm_type
   AND old_link.osm_id = stage.osm_id
`;

const ACTIVATE_NEW_PLACES_SQL = `
  WITH candidates AS (
    SELECT
      boundary.id,
      ROW_NUMBER() OVER (
        PARTITION BY
          LOWER(REGEXP_REPLACE(boundary.display_type, '[[:space:]]+', '', 'g')),
          LOWER(REGEXP_REPLACE(boundary.display_name, '[[:space:]]+', '', 'g'))
        ORDER BY
          (boundary.osm_type = 'relation') DESC,
          boundary.area_m2 DESC,
          boundary.id
      ) AS rn
    FROM city_boundaries AS boundary
    LEFT JOIN old_city_boundary_links AS old_link
      ON old_link.osm_type = boundary.osm_type
     AND old_link.osm_id = boundary.osm_id
    WHERE old_link.osm_id IS NULL
      AND boundary.place_type IN ('city', 'town')
  )
  UPDATE city_boundaries AS boundary
  SET is_active = TRUE,
      updated_at = now()
  FROM candidates
  WHERE candidates.id = boundary.id
    AND candidates.rn = 1
    AND NOT EXISTS (
      SELECT 1
      FROM city_boundaries AS active
      WHERE active.is_active
        AND active.id <> boundary.id
        AND LOWER(REGEXP_REPLACE(active.display_type, '[[:space:]]+', '', 'g'))
            = LOWER(REGEXP_REPLACE(boundary.display_type, '[[:space:]]+', '', 'g'))
        AND LOWER(REGEXP_REPLACE(active.display_name, '[[:space:]]+', '', 'g'))
            = LOWER(REGEXP_REPLACE(boundary.display_name, '[[:space:]]+', '', 'g'))
    )
`;

const RESTORE_GEOMETRY_LINKS_SQL = `
  UPDATE city_geometries AS geometry
  SET boundary_id = boundary.id
  FROM old_geometry_boundary_links AS old_link
  JOIN city_boundaries AS boundary
    ON boundary.osm_type = old_link.osm_type
   AND boundary.osm_id = old_link.osm_id
  WHERE geometry.id = old_link.geometry_id
`;

const INSERT_RUN_SQL = `
  INSERT INTO osm_city_update_runs (
    source_url,
    checksum,
    downloaded_bytes,
    source_elements,
    imported_cities,
    ignored_elements,
    osm_timestamp,
    city_places,
    town_places,
    duplicate_names,
    administrative_places,
    duplicate_index_objects,
    batch_size,
    batch_count
  )
  VALUES (
    $1, $2, $3, $4, $5, $6, $7::timestamptz,
    $8, $9, $10, $11, $12, $13, $14
  )
  RETURNING id::integer AS id, created_at AS "createdAt"
`;

export class OsmCityGeometryError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OsmCityGeometryError';
  }
}

/** @param {{ osmType: string, osmId: number }} object */
function objectKey(object) {
  return `${object.osmType}/${object.osmId}`;
}

/** @param {any[]} expected @param {any[]} places @param {number} batchNumber */
function assertCompleteBatch(expected, places, batchNumber) {
  const expectedKeys = new Set(expected.map(objectKey));
  const actualKeys = new Set(places.map(objectKey));
  const missing = [...expectedKeys].filter((key) => !actualKeys.has(key));
  const unexpected = [...actualKeys].filter((key) => !expectedKeys.has(key));
  if (missing.length > 0 || unexpected.length > 0) {
    const details = [];
    if (missing.length > 0) details.push(`missing: ${missing.join(', ')}`);
    if (unexpected.length > 0) {
      details.push(`unexpected: ${unexpected.join(', ')}`);
    }
    throw new OsmCityGeometryError(
      `OSM geometry batch ${batchNumber} does not match its ID index (${details.join('; ')})`,
    );
  }
}

/** @param {Map<string, number>} counts @param {any[]} places */
function addNameCounts(counts, places) {
  for (const place of places) {
    counts.set(place.name, (counts.get(place.name) ?? 0) + 1);
  }
}

/** @param {any} client */
async function assertValidStage(client) {
  const invalidResult = await client.query(INVALID_STAGE_SQL);
  if (invalidResult.rows.length > 0) {
    const names = invalidResult.rows.map((row) => row.name).join(', ');
    throw new OsmCityGeometryError(
      `OSM way geometry does not form a valid place polygon: ${names}`,
    );
  }
}

/** @param {any[]} parts */
function combineIndexParts(parts) {
  const keys = new Set();
  const objects = [];
  const timestamps = [];
  let sourceElements = 0;
  let duplicateIndexObjects = 0;
  for (const part of parts) {
    sourceElements += part.sourceElements;
    if (part.osmTimestamp) timestamps.push(Date.parse(part.osmTimestamp));
    for (const object of part.objects) {
      const key = objectKey(object);
      if (keys.has(key)) {
        duplicateIndexObjects += 1;
        continue;
      }
      keys.add(key);
      objects.push(object);
    }
  }
  if (objects.length === 0) {
    throw new OsmCityUpdateValidationError(
      'OSM ID index contains no enabled named place/admin boundary objects',
    );
  }
  objects.sort((left, right) =>
    left.osmType.localeCompare(right.osmType) || left.osmId - right.osmId);
  return {
    objects,
    sourceElements,
    duplicateIndexObjects,
    osmTimestamp: timestamps.length > 0
      ? new Date(Math.min(...timestamps)).toISOString()
      : null,
  };
}

/**
 * Replace the complete Russian OSM place=city/town boundary snapshot atomically.
 * Geometry responses are downloaded sequentially into a session-local staging
 * table; production boundaries are changed only after every indexed object has
 * been downloaded and validated.
 *
 * @param {{ connect: () => Promise<any>, databaseSchema?: string }} pool
 * @param {any} config
 * @param {{
 *   download?: typeof downloadOsmCities,
 *   parseIndex?: typeof parseOsmPlaceIdsResponse,
 *   parseBatch?: typeof parseOsmCityResponse,
 *   reportProgress?: (progress: object) => void,
 *   sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>,
 *   now?: () => number
 * }} [dependencies]
 */
export function createOsmCityUpdateService(pool, config, dependencies = {}) {
  const download = dependencies.download ?? downloadOsmCities;
  const parseIndex = dependencies.parseIndex ?? parseOsmPlaceIdsResponse;
  const parseBatch = dependencies.parseBatch ?? parseOsmCityResponse;
  const settingsRepository = dependencies.settingsRepository;
  const sleep = dependencies.sleep ?? abortableDelay;
  const now = dependencies.now ?? Date.now;
  const reportProgress = dependencies.reportProgress ?? ((progress) => {
    if (progress.phase === 'index') {
      console.info(
        `OSM city update index ${progress.indexPart}/${progress.indexPartCount}: ` +
        `${progress.indexedPlaces} place IDs loaded`,
      );
      return;
    }
    if (progress.phase === 'retry') {
      const reason = progress.retryKind === 'network'
        ? `network ${progress.networkCode ?? progress.networkMessage ?? 'failure'}`
        : `HTTP ${progress.statusCode}`;
      console.warn(
        `OSM city update ${reason}: retry ` +
        `${progress.attempt}/${progress.maxRetries} in ${progress.waitMs} ms`,
      );
      return;
    }
    if (progress.phase === 'split') {
      const reason = progress.reason === 'http-504'
        ? `HTTP 504 after ${progress.retryCount} retries`
        : `response exceeded ${progress.limitBytes} bytes`;
      console.warn(
        `OSM geometry batch ${progress.batch}: ${reason}; split ` +
        `${progress.objectCount} objects into ${progress.splitSizes.join('+')}`,
      );
      return;
    }
    console.info(
      `OSM city update batch ${progress.batch}/${progress.batchCount}: ` +
      `${progress.stagedPlaces}/${progress.indexedPlaces} places staged`,
    );
  });

  return {
    /**
     * @param {unknown} body
     * @param {Record<string, unknown>} query
     * @param {{ signal?: AbortSignal, onProgress?: (progress: object) => void, onCommit?: () => void }} operation
     */
    async update(body, query = {}, operation = {}) {
      throwIfAdminTaskCancelled(operation.signal);
      const savedSettings = settingsRepository
        ? await settingsRepository.get()
        : null;
      if (savedSettings?.sourceURL) {
        const savedSourceURL = normalizeOsmUpdateUrl(
          savedSettings.sourceURL,
          config.allowedHosts,
        );
        if (config.allowedURLs && !config.allowedURLs.has(savedSourceURL)) {
          throw new OsmCityUpdateValidationError(
            `Saved OSM URL is no longer allowed by deployment configuration: ${savedSourceURL}`,
          );
        }
      }
      const runtimeConfig = savedSettings
        ? {
            ...config,
            url: savedSettings.sourceURL,
            includeCity: savedSettings.includeCity,
            includeTown: savedSettings.includeTown,
            includeAdministrative: savedSettings.includeAdministrative,
            adminLevelMin: savedSettings.adminLevelMin,
            adminLevelMax: savedSettings.adminLevelMax,
            batchSize: savedSettings.batchSize,
            minDelayMs: savedSettings.minDelayMs,
            timeoutMs: savedSettings.timeoutMs,
            queryTimeoutSeconds: savedSettings.queryTimeoutSeconds,
            maxResponseBytes: savedSettings.maxResponseBytes,
            maxTotalBytes: savedSettings.maxTotalBytes,
            maxRetries: savedSettings.maxRetries,
            retryBaseDelayMs: savedSettings.retryBaseDelayMs,
            retryMaxDelayMs: savedSettings.retryMaxDelayMs,
          }
        : config;
      const options = resolveOsmCityUpdateRequest(body, query, runtimeConfig);
      const checksumHash = crypto.createHash('sha256');
      let downloadedBytes = 0;
      let lastRequestCompletedAt = null;
      let requestAttemptCount = 0;
      let retryCount = 0;
      let retryWaitMs = 0;
      let throttleWaitMs = 0;

      const downloadQuery = async (overpassQuery, requestProgress) => {
        for (let attempt = 0; ; attempt += 1) {
          throwIfAdminTaskCancelled(operation.signal);
          if (lastRequestCompletedAt !== null) {
            const waitMs = Math.max(
              0,
              lastRequestCompletedAt + options.minDelayMs - now(),
            );
            if (waitMs > 0) {
              throttleWaitMs += waitMs;
              await sleep(waitMs, operation.signal);
            }
          }

          const remainingTotalBytes =
            options.maxTotalBytes - downloadedBytes;
          if (remainingTotalBytes < 1) {
            throw new OsmCityDownloadError(
              'OSM responses exceed the configured total size limit',
              {
                code: 'total-size-limit',
                limitBytes: options.maxTotalBytes,
                receivedBytes: downloadedBytes,
              },
            );
          }
          const responseLimitBytes = Math.min(
            options.maxResponseBytes,
            remainingTotalBytes,
          );

          requestAttemptCount += 1;
          try {
            const downloaded = await download(options.url, overpassQuery, {
              allowedHosts: config.allowedHosts,
              timeoutMs: options.timeoutMs,
              maxBytes: responseLimitBytes,
              userAgent: config.userAgent,
              signal: operation.signal,
            });
            lastRequestCompletedAt = now();
            throwIfAdminTaskCancelled(operation.signal);
            downloadedBytes += downloaded.bytes;
            checksumHash
              .update(String(downloaded.bytes))
              .update(':')
              .update(downloaded.jsonText);
            return downloaded;
          } catch (error) {
            lastRequestCompletedAt = now();
            if (
              error instanceof OsmCityDownloadError &&
              error.code === 'response-size-limit' &&
              responseLimitBytes < options.maxResponseBytes
            ) {
              const totalLimitError = new OsmCityDownloadError(
                'OSM responses exceed the configured total size limit',
                {
                  code: 'total-size-limit',
                  limitBytes: options.maxTotalBytes,
                  receivedBytes: downloadedBytes,
                  finalURL: error.finalURL,
                },
              );
              totalLimitError.cause = error;
              throw totalLimitError;
            }
            const retryableHttp =
              error instanceof OsmCityDownloadError &&
              RETRYABLE_HTTP_STATUS_CODES.has(error.statusCode);
            const retryableNetwork =
              error instanceof OsmCityDownloadError &&
              error.retryable === true &&
              (
                error.code === 'network-error' ||
                error.code === 'network-timeout'
              );
            if (!retryableHttp && !retryableNetwork) {
              throw error;
            }

            const retryAttempt = attempt + 1;
            const splitEligible504 =
              retryableHttp &&
              error.statusCode === 504 &&
              requestProgress.requestPhase === 'geometry' &&
              (requestProgress.objectCount ?? 0) > 1;
            const retryLimit = splitEligible504
              ? Math.min(
                  options.maxRetries,
                  GEOMETRY_504_RETRIES_BEFORE_SPLIT,
                )
              : options.maxRetries;
            if (retryAttempt > retryLimit) {
              const exhausted = new OsmCityDownloadError(
                retryableNetwork
                  ? `OSM network download failed after ${retryLimit} retries: ` +
                    `${error.networkCode ?? error.networkMessage ?? 'network failure'}`
                  : `OSM download returned HTTP ${error.statusCode} after ` +
                    `${retryLimit} retries`,
                {
                  statusCode: error.statusCode,
                  retryAfterMs: error.retryAfterMs,
                  finalURL: error.finalURL,
                  code: splitEligible504
                    ? 'geometry-504-retry-limit'
                    : 'retry-limit',
                  networkCode: error.networkCode,
                  networkMessage: error.networkMessage,
                  retryable: false,
                },
              );
              exhausted.retryCount = retryLimit;
              exhausted.configuredMaxRetries = options.maxRetries;
              exhausted.cause = error;
              throw exhausted;
            }

            const fallbackDelayMs = Math.min(
              options.retryBaseDelayMs * (2 ** (retryAttempt - 1)),
              options.retryMaxDelayMs,
            );
            const waitMs = Math.max(
              options.minDelayMs,
              fallbackDelayMs,
              error.retryAfterMs ?? 0,
            );
            retryCount += 1;
            retryWaitMs += waitMs;
            const progress = {
              phase: 'retry',
              ...requestProgress,
              retryKind: retryableNetwork ? 'network' : 'http',
              statusCode: error.statusCode,
              networkCode: error.networkCode,
              networkMessage: error.networkMessage,
              attempt: retryAttempt,
              maxRetries: retryLimit,
              configuredMaxRetries: options.maxRetries,
              waitMs,
              retryAt: new Date(now() + waitMs).toISOString(),
              retryAfterMs: error.retryAfterMs,
              fallbackDelayMs,
            };
            reportProgress(progress);
            operation.onProgress?.(progress);
            await sleep(waitMs, operation.signal);
            lastRequestCompletedAt = null;
          }
        }
      };

      const indexQueries = buildRussianPlaceIdOverpassQueries(
        options.queryTimeoutSeconds,
        options,
      );
      const indexParts = [];
      const indexFinalURLs = new Set();
      const indexedKeys = new Set();
      let indexedPlaces = 0;
      for (const [partOffset, indexQuery] of indexQueries.entries()) {
        const indexDownload = await downloadQuery(indexQuery.query, {
          requestPhase: 'index',
          indexPart: partOffset + 1,
          indexPartCount: indexQueries.length,
        });
        const parsedPart = parseIndex(indexDownload.jsonText);
        const wrongType = parsedPart.objects.find((object) =>
          object.osmType !== indexQuery.osmType);
        if (wrongType) {
          throw new OsmCityUpdateValidationError(
            `OSM ${indexQuery.kind}/${indexQuery.osmType} index returned ${objectKey(wrongType)}`,
          );
        }
        indexParts.push(parsedPart);
        indexFinalURLs.add(indexDownload.finalURL);
        for (const object of parsedPart.objects) indexedKeys.add(objectKey(object));
        indexedPlaces = indexedKeys.size;
        const progress = {
          phase: 'index',
          indexPart: partOffset + 1,
          indexPartCount: indexQueries.length,
          indexedPlaces,
        };
        reportProgress(progress);
        operation.onProgress?.(progress);
      }
      const index = combineIndexParts(indexParts);
      const geometryBatches = [];
      for (let offset = 0; offset < index.objects.length; offset += options.batchSize) {
        geometryBatches.push(index.objects.slice(offset, offset + options.batchSize));
      }
      const client = await pool.connect();
      let inTransaction = false;
      try {
        throwIfAdminTaskCancelled(operation.signal);
        await client.query(DROP_STAGE_SQL);
        await client.query(CREATE_STAGE_SQL);
        let cityPlaces = 0;
        let townPlaces = 0;
        let administrativePlaces = 0;
        let ignoredElements = 0;
        let stagedPlaces = 0;
        const nameCounts = new Map();

        for (let batchIndex = 0; batchIndex < geometryBatches.length;) {
          throwIfAdminTaskCancelled(operation.signal);
          const objects = geometryBatches[batchIndex];
          const batchNumber = batchIndex + 1;
          let batchDownload;
          try {
            batchDownload = await downloadQuery(
              buildOsmPlacesBatchQuery(objects, options.queryTimeoutSeconds),
              {
                requestPhase: 'geometry',
                batch: batchNumber,
                batchCount: geometryBatches.length,
                objectCount: objects.length,
              },
            );
          } catch (error) {
            const oversizedResponse =
              error instanceof OsmCityDownloadError &&
              error.code === 'response-size-limit';
            const exhausted504 =
              error instanceof OsmCityDownloadError &&
              error.code === 'geometry-504-retry-limit' &&
              error.statusCode === 504;

            if (oversizedResponse || exhausted504) {
              if (objects.length === 1) {
                const object = objects[0];
                const objectError = new OsmCityDownloadError(
                  oversizedResponse
                    ? `OSM object ${objectKey(object)} exceeds the configured single-response size limit`
                    : `OSM object ${objectKey(object)} still returns HTTP 504 after ${options.maxRetries} retries`,
                  {
                    code: oversizedResponse
                      ? 'response-size-limit'
                      : 'retry-limit',
                    statusCode: error.statusCode,
                    limitBytes: options.maxResponseBytes,
                    receivedBytes: error.receivedBytes,
                    finalURL: error.finalURL,
                  },
                );
                objectError.cause = error;
                throw objectError;
              }

              const splitAt = Math.ceil(objects.length / 2);
              const left = objects.slice(0, splitAt);
              const right = objects.slice(splitAt);
              geometryBatches.splice(batchIndex, 1, left, right);
              const progress = {
                phase: 'split',
                requestPhase: 'geometry',
                reason: exhausted504 ? 'http-504' : 'response-size-limit',
                statusCode: exhausted504 ? 504 : undefined,
                retryCount: exhausted504 ? error.retryCount : 0,
                configuredMaxRetries: options.maxRetries,
                batch: batchNumber,
                batchCount: geometryBatches.length,
                objectCount: objects.length,
                splitSizes: [left.length, right.length],
                limitBytes: oversizedResponse
                  ? options.maxResponseBytes
                  : undefined,
                indexedPlaces: index.objects.length,
                stagedPlaces,
              };
              reportProgress(progress);
              operation.onProgress?.(progress);
              continue;
            }
            throw error;
          }

          const parsed = parseBatch(batchDownload.jsonText);
          assertCompleteBatch(objects, parsed.places, batchNumber);

          const stageResult = await client.query(INSERT_STAGE_SQL, [
            JSON.stringify(parsed.places),
          ]);
          if (stageResult.rowCount !== parsed.places.length) {
            throw new Error(`Not every OSM place in batch ${batchNumber} was staged`);
          }
          await assertValidStage(client);
          throwIfAdminTaskCancelled(operation.signal);

          cityPlaces += parsed.cityPlaces;
          townPlaces += parsed.townPlaces;
          administrativePlaces += parsed.administrativePlaces ?? 0;
          ignoredElements += parsed.ignoredElements;
          stagedPlaces += parsed.places.length;
          addNameCounts(nameCounts, parsed.places);
          const progress = {
            phase: 'geometry',
            batch: batchNumber,
            batchCount: geometryBatches.length,
            stagedPlaces,
            indexedPlaces: index.objects.length,
          };
          reportProgress(progress);
          operation.onProgress?.(progress);
          batchIndex += 1;
        }

        const stageCountResult = await client.query(COUNT_STAGE_SQL);
        if (stageCountResult.rows[0]?.count !== index.objects.length) {
          throw new Error('Not every indexed OSM place was staged');
        }
        await assertValidStage(client);
        throwIfAdminTaskCancelled(operation.signal);

        await client.query('BEGIN');
        inTransaction = true;
        await acquireDataImportLock(client, pool);
        await client.query(PRESERVE_LINKS_SQL);
        throwIfAdminTaskCancelled(operation.signal);
        await client.query('DELETE FROM city_boundaries');
        const boundaryResult = await client.query(INSERT_BOUNDARIES_SQL, [
          index.osmTimestamp,
        ]);
        if (boundaryResult.rowCount !== index.objects.length) {
          throw new Error('Not every OSM boundary was inserted');
        }
        await client.query(ACTIVATE_NEW_PLACES_SQL);
        await client.query('SELECT rebuild_city_boundary_hierarchy()');
        const restoredLinksResult = await client.query(
          RESTORE_GEOMETRY_LINKS_SQL,
        );
        // DELETE FROM city_boundaries temporarily clears boundary_id through
        // ON DELETE SET NULL. Restore exact OSM links before synchronizing
        // city_id so renamed/reassigned active boundaries can realign existing
        // line rows as part of the same transaction.
        await client.query('SELECT sync_active_boundary_cities()');
        await client.query(RECALCULATE_CITY_STATISTICS_SQL);
        throwIfAdminTaskCancelled(operation.signal);

        const checksum = checksumHash.digest('hex');
        const result = {
          dryRun: options.dryRun,
          sourceURL: options.url,
          indexFinalURLs: [...indexFinalURLs],
          indexRequestCount: indexQueries.length,
          downloadedBytes,
          sourceElements: index.sourceElements,
          importedPlaces: index.objects.length,
          cityPlaces,
          townPlaces,
          administrativePlaces,
          duplicateIndexObjects: index.duplicateIndexObjects,
          duplicateNames: [...nameCounts.values()]
            .filter((count) => count > 1).length,
          ignoredElements,
          batchSize: options.batchSize,
          batchCount: geometryBatches.length,
          maxResponseBytes: options.maxResponseBytes,
          maxTotalBytes: options.maxTotalBytes,
          minDelayMs: options.minDelayMs,
          maxRetries: options.maxRetries,
          requestAttemptCount,
          retryCount,
          retryWaitMs,
          throttleWaitMs,
          restoredGeometryLinks: restoredLinksResult.rowCount,
          osmTimestamp: index.osmTimestamp,
          checksum,
          completedAt: new Date().toISOString(),
        };
        if (options.dryRun) {
          await client.query('ROLLBACK');
          inTransaction = false;
          return result;
        }

        const runResult = await client.query(INSERT_RUN_SQL, [
          options.url,
          checksum,
          downloadedBytes,
          index.sourceElements,
          index.objects.length,
          ignoredElements,
          index.osmTimestamp,
          cityPlaces,
          townPlaces,
          result.duplicateNames,
          administrativePlaces,
          index.duplicateIndexObjects,
          options.batchSize,
          geometryBatches.length,
        ]);
        throwIfAdminTaskCancelled(operation.signal);
        operation.onCommit?.();
        await client.query('COMMIT');
        inTransaction = false;
        return {
          ...result,
          updateRunId: runResult.rows[0].id,
          completedAt: runResult.rows[0].createdAt,
        };
      } catch (error) {
        if (inTransaction) await client.query('ROLLBACK');
        throw error;
      } finally {
        await client.query(DROP_STAGE_SQL).catch(() => {});
        client.release();
      }
    },
  };
}