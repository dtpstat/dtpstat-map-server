import crypto from 'node:crypto';
import { throwIfAdminTaskCancelled } from '../../shared/tasks/admin-task-manager.js';
import { downloadKml } from './kml-downloader.js';
import { parseKmlSource } from './kml-parser.js';
import { comparableLineTypeName } from './type-policy.js';
import {
  KmlUpdateValidationError,
  resolveKmlUpdateRequest,
} from './kml-update-options.js';
import {
  createKmlUpdateRepository,
} from './kml-update-repository.js';
export class KmlUpdateMatchError extends Error {
  constructor(message) {
    super(message);
    this.name = 'KmlUpdateMatchError';
  }
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
 *   repository?: ReturnType<typeof createKmlUpdateRepository>,
 *   acquireLock: (client: any, pool: any) => Promise<void>,
 *   recalculateStatistics: (client: any) => Promise<any>
 * }} dependencies
 */
export function createKmlUpdateService(pool, config, dependencies) {
  const download = dependencies?.download ?? downloadKml;
  const parse = dependencies?.parse ?? parseKmlSource;
  const repository =
    dependencies?.repository ?? createKmlUpdateRepository();
  const acquireLock = dependencies?.acquireLock;
  const recalculateStatistics = dependencies?.recalculateStatistics;

  if (typeof acquireLock !== 'function') {
    throw new TypeError('KML update acquireLock dependency is required');
  }
  if (typeof recalculateStatistics !== 'function') {
    throw new TypeError(
      'KML update recalculateStatistics dependency is required',
    );
  }

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
        await acquireLock(client, pool);
        throwIfAdminTaskCancelled(operation.signal);

        let typeRows = (
          await repository.loadLineTypes(client, referencedNames)
        ).rows;
        const missingNames = missingTypeNames(referencedNames, typeRows);
        let createdLineTypes = [];
        let wouldCreateLineTypes = [];

        if (options.dryRun) {
          // PostgreSQL sequences are non-transactional. Do not INSERT here:
          // a rolled-back dry run must not consume future numeric CODE values.
          wouldCreateLineTypes = previewLineTypes(missingNames);
          typeRows = [...typeRows, ...wouldCreateLineTypes.map((lineType) => ({
            requestedName: lineType.name,
            ...lineType,
          }))];
        } else if (missingNames.length > 0) {
          const created = await repository.insertMissingLineTypes(
            client,
            missingNames,
          );
          createdLineTypes = created.rows;
          typeRows = (
            await repository.loadLineTypes(client, referencedNames)
          ).rows;
        }

        const typeByName = new Map(
          typeRows.map((lineType) => [
            comparableLineTypeName(lineType.requestedName ?? lineType.name),
            lineType,
          ]),
        );
        if (typeByName.size !== referencedNames.length) {
          throw new Error('Not every imported KML business type was resolved');
        }

        const boundaryResult = await repository.boundariesReady(client);
        if (!boundaryResult.rows[0]?.ready) {
          throw new KmlUpdateMatchError(
            'OSM place boundaries are empty; run POST /api/admin/update/cities first',
          );
        }

        await repository.prepareMatchGeometries(
          client,
          options.cityBufferMeters,
        );
        const matchResult = await repository.matchGeometries(
          client,
          matchPayload,
        );
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

        const matchedCityPayload = matchedRows.map((row) => ({
          cityName: row.cityName ?? row.placeName,
          boundaryId: row.boundaryId,
        }));
        let cityIdByBoundary = new Map(
          matchedRows
            .filter((row) => row.cityId !== null)
            .map((row) => [Number(row.boundaryId), Number(row.cityId)]),
        );

        if (!options.dryRun) {
          await repository.upsertMatchedCities(
            client,
            matchedCityPayload,
          );
          await repository.linkMatchedCities(
            client,
            matchedCityPayload,
          );
          const cityResult = await repository.loadMatchedCityIds(
            client,
            matchedCityPayload,
          );
          cityIdByBoundary = new Map(
            cityResult.rows.map((row) => [Number(row.boundaryId), Number(row.id)]),
          );
          if (cityIdByBoundary.size !== new Set(
            matchedCityPayload.map((row) => Number(row.boundaryId)),
          ).size) {
            throw new Error('Not every active OSM boundary was resolved to a city record');
          }
        }

        const matched = matchedRows.map((row) => {
          const feature = features[row.inputIndex];
          const lineType = typeByName.get(
            comparableLineTypeName(feature.businessTypeName),
          );
          const cityName = row.cityName ?? row.placeName;
          const cityId = row.cityId === null
            ? cityIdByBoundary.get(Number(row.boundaryId)) ?? null
            : Number(row.cityId);
          if (!options.dryRun && cityId === null) {
            throw new Error(`Matched OSM place has no city record: ${cityName}`);
          }
          return {
            cityId,
            cityName,
            boundaryId: row.boundaryId,
            lineTypeId: lineType.id,
            businessTypeCode: lineType.code,
            businessTypeName: lineType.name,
            multiple: feature.multiple,
            properties: feature.properties,
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

        await repository.clearGeometries(client);
        const insertResult = await repository.insertGeometries(
          client,
          matched,
        );
        if (insertResult.rowCount !== matched.length) {
          throw new Error('Not every matched KML geometry was inserted');
        }
        await recalculateStatistics(client);
        throwIfAdminTaskCancelled(operation.signal);
        const runResult = await repository.insertUpdateRun(client, [
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
