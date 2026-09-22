import express, { Router } from 'express';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  AdminTaskAlreadyRunningError,
} from '../data/admin-task-manager.js';
import { adminAuditPayloadFingerprint } from '../data/admin-audit-details.js';
import {
  KmlUpdateValidationError,
  resolveKmlUpdateRequest,
} from '../data/kml-update-options.js';
import {
  OsmCityUpdateValidationError,
  resolveOsmCityUpdateRequest,
} from '../data/osm-city-update-options.js';
import { createSingleFileZipStream } from '../data/single-file-zip.js';
import {
  openUploadedJson,
  receiveStreamUpload,
  removeStreamUpload,
  StreamUploadError,
} from '../http/stream-upload.js';
import {
  adminClientIp,
  createAdminOperationAudit,
} from '../http/admin-auth.js';

/**
 * @typedef {{
 *   health: () => Promise<void>,
 *   listCities: () => Promise<any[]>,
 *   getCityGeometries: (cityId: number) => Promise<object | null>,
 *   getViewportGeometries: (viewport: object) => Promise<object>
 * }} CitiesRepository
 */

/**
 * @typedef {{
 *   exportCityBoundaries: () => Promise<object>,
 *   exportLines: () => Promise<object>,
 *   exportPopulations: () => Promise<object>
 * }} DataExportRepository
 */

/** @typedef {{ replaceFromGeoJson: (collection: unknown, operation?: object) => Promise<object> }} DataImportService */
/** @typedef {{ replaceFromGeoJson: (collection: unknown, operation?: object) => Promise<object> }} CityBoundaryTransferService */
/** @typedef {{ updateFromJson: (payload: unknown, operation?: object) => Promise<object> }} PopulationImportService */
/** @typedef {{ update: (body: unknown, query: Record<string, unknown>, operation?: object) => Promise<object> }} KmlUpdateService */
/** @typedef {{ update: (body: unknown, query: Record<string, unknown>, operation?: object) => Promise<object> }} OsmCityUpdateService */

/**
 * @param {{
 *   repository: CitiesRepository,
 *   exportRepository: DataExportRepository,
 *   importService: DataImportService,
 *   cityBoundaryTransferService: CityBoundaryTransferService,
 *   populationService: PopulationImportService,
 *   kmlUpdateService: KmlUpdateService,
 *   osmCityUpdateService: OsmCityUpdateService,
 *   adminTasks: ReturnType<import('../data/admin-task-manager.js').createAdminTaskManager>,
 *   adminAuth: ReturnType<import('../http/admin-auth.js').createAdminAuthorization>,
 *   securityService: ReturnType<import('../data/admin-security.js').createAdminSecurityService>,
 *   publicMap: object,
 *   importApi: {
 *     maxBodyBytes: number,
 *     maxStreamUploadBytes: number,
 *     maxStreamJsonBytes: number,
 *     maxStreamItemBytes: number,
 *     maxStreamZipCompressionRatio?: number,
 *     maxStreamZipEntries?: number,
 *     maxStreamJsonDepth?: number,
 *     maxStreamJsonItems?: number,
 *     streamUploadDirectory: string
 *   },
 *   kmlUpdate: { maxRequestBodyBytes: number, cityBufferMeters: number, cityBufferMaxMeters: number },
 *   osmCityUpdate: any
 * }} dependencies
 */
export function createApiRouter({
  repository,
  exportRepository,
  importService,
  cityBoundaryTransferService,
  populationService,
  kmlUpdateService,
  osmCityUpdateService,
  adminTasks,
  adminAuth,
  securityService,
  publicMap,
  importApi,
  kmlUpdate,
  osmCityUpdate,
}) {
  const router = Router();
  const streamTransfer = {
    uploadDirectory: importApi.streamUploadDirectory ??
      path.join(process.cwd(), 'var', 'import-staging'),
    maxUploadBytes: importApi.maxStreamUploadBytes ?? importApi.maxBodyBytes,
    maxJsonBytes: importApi.maxStreamJsonBytes ?? importApi.maxBodyBytes,
    maxItemBytes: importApi.maxStreamItemBytes ?? importApi.maxBodyBytes,
    maxZipCompressionRatio:
      importApi.maxStreamZipCompressionRatio ?? 1000,
    maxZipEntries: importApi.maxStreamZipEntries ?? 64,
    maxJsonDepth: importApi.maxStreamJsonDepth ?? 128,
    maxJsonItems: importApi.maxStreamJsonItems ?? 5_000_000,
  };
  const adminStatusURL = (request, taskId) =>
    `${request.baseUrl}/admin/status/${taskId}`;
  const operationAudit = (type) => createAdminOperationAudit(securityService, type);

  const respondWithActiveTask = (request, response, task) => {
    const statusURL = adminStatusURL(request, task.id);
    response.set('Cache-Control', 'no-store');
    response.status(409).json({
      error: 'Another data-management task is already active',
      taskId: task.id,
      task: {
        id: task.id,
        type: task.type,
        status: task.status,
      },
      statusURL,
    });
  };

  const rejectWhileAdminTaskActive = (request, response, next) => {
    const activeTask = adminTasks.active();
    if (activeTask) {
      respondWithActiveTask(request, response, activeTask);
      return;
    }
    next();
  };

  const clearCompletedAdminTask = (_request, _response, next) => {
    adminTasks.clearCompleted?.();
    next();
  };

  const progressLog = (context, progress) => {
    let message = `Прогресс: ${progress.phase}`;
    if (progress.phase === 'resume') {
      message = `OSM: возобновление checkpoint ${progress.checkpointId}; уже загружено ${progress.stagedPlaces}/${progress.indexedPlaces}, осталось ${progress.remainingPlaces}`;
      if ((progress.unbuildableGeometryPlaces ?? 0) > 0) {
        message += `; без построенного полигона ${progress.unbuildableGeometryPlaces}`;
      }
    } else if (progress.phase === 'index') {
      message = `OSM: загружена часть индекса ${progress.indexPart}/${progress.indexPartCount}`;
    } else if (progress.phase === 'geometry') {
      message = `OSM: обработан пакет ${progress.batch}/${progress.batchCount}`;
      if ((progress.batchUnbuildableGeometryPlaces ?? 0) > 0) {
        message += `; без построенного полигона ${progress.batchUnbuildableGeometryPlaces}`;
      }
    } else if (progress.phase === 'retry') {
      const target = progress.requestPhase === 'geometry'
        ? `пакет ${progress.batch}/${progress.batchCount}`
        : `часть индекса ${progress.indexPart}/${progress.indexPartCount}`;
      const reason = progress.retryKind === 'network'
        ? `сетевая ошибка ${progress.networkCode ?? progress.networkMessage ?? 'fetch'}`
        : `HTTP ${progress.statusCode}`;
      message = `OSM: ${reason}, ${target}; повтор ${progress.attempt}/${progress.maxRetries} через ${Math.ceil(progress.waitMs / 1000)} сек.`;
    } else if (progress.phase === 'split') {
      message = progress.reason === 'http-504'
        ? `OSM: пакет ${progress.batch} получил HTTP 504 после ${progress.retryCount} повторов; разделён ${progress.objectCount} → ${progress.splitSizes.join(' + ')} объектов`
        : `OSM: пакет ${progress.batch} слишком большой; разделён ${progress.objectCount} → ${progress.splitSizes.join(' + ')} объектов`;
    } else if (progress.phase === 'kml-source') {
      message = `KML: обработан источник ${progress.source}/${progress.sourceCount}`;
    } else if (progress.phase === 'stage-write') {
      message =
        `PostgreSQL/PostGIS: запись staging-пакета ${progress.batch ?? '?'}` +
        ` (${progress.batchPlaces ?? '?'} объектов)`;
    } else if (progress.phase === 'stage') {
      message =
        `PostgreSQL/PostGIS: staging-пакет ${progress.batch ?? '?'} записан; ` +
        `всего ${progress.stagedPlaces ?? '?'} объектов`;
    } else if (progress.phase === 'delete-boundaries') {
      message =
        `Удаление старого snapshot территорий` +
        (progress.places ? `; новый snapshot: ${progress.places} объектов` : '');
    } else if (progress.phase === 'insert-boundaries') {
      message =
        `Вставка нового snapshot территорий` +
        (progress.places ? `; объектов: ${progress.places}` : '');
    } else if (progress.phase === 'hierarchy') {
      message =
        `Иерархия территорий: ${progress.processed ?? 0}/${progress.total ?? '?'}` +
        (progress.batchCount
          ? `; пакет ${progress.batch ?? 0}/${progress.batchCount}`
          : '');
    } else if (progress.phase === 'validated') {
      message = 'Входные данные проверены';
    } else if (progress.phase === 'warnings') {
      message =
        `Импорт продолжен с предупреждениями: ` +
        `${progress.warningCount ?? 0}; пропущено записей: ` +
        `${progress.skippedCount ?? 0}`;
    } else if (progress.phase === 'database') {
      message = 'Изменения базы данных подготовлены';
    }
    context.log(
      message,
      progress,
      progress.phase === 'warnings' ? 'warning' : 'info',
    );
  };

  const parseCoordinates = (value, count) => {
    if (typeof value !== 'string') return null;
    const parts = value.split(',');
    if (parts.length !== count || parts.some((part) => part.trim() === '')) return null;
    const coordinates = parts.map((part) => Number(part));
    return coordinates.every(Number.isFinite) ? coordinates : null;
  };

  const parseBoolean = (value, fallback = false) => {
    if (value === undefined) return fallback;
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return null;
  };

  const actorFor = (request) => request.adminUser
    ? {
        userId: request.adminUser.id,
        username: request.adminUser.username,
        ipAddress: adminClientIp(request),
      }
    : undefined;

  const startAdminTask = (request, response, next, definition, executor) => {
    try {
      const task = adminTasks.start(
        {
          ...definition,
          actor: actorFor(request),
        },
        executor,
      );
      const statusURL = adminStatusURL(request, task.id);
      response.set('Cache-Control', 'no-store');
      response.location(statusURL);
      response.status(202).json({
        status: 'accepted',
        taskId: task.id,
        task: { ...task, statusURL },
      });
      return task;
    } catch (error) {
      if (error instanceof AdminTaskAlreadyRunningError) {
        respondWithActiveTask(request, response, error.task);
        return null;
      }
      next(error);
      return null;
    }
  };

  const jsonBody = (limit, type) => express.json({
    limit,
    strict: true,
    inflate: true,
    type,
  });

  const streamingExportRoute = (
    fileName,
    contentType,
    streamLoader,
    fallbackLoader,
    zip = false,
  ) => async (request, response, next) => {
    try {
      const source = typeof streamLoader === 'function'
        ? streamLoader()
        : [JSON.stringify(await fallbackLoader()), '\n'];
      const output = zip
        ? createSingleFileZipStream(fileName, source, {
            signal: request.signal,
          })
        : Readable.from(source);
      const downloadName = zip
        ? `${fileName.replace(/\.(?:geojson|json)$/iu, '')}.zip`
        : fileName;
      response
        .set('Cache-Control', 'no-store')
        .set(
          'Content-Disposition',
          `attachment; filename="${downloadName}"`,
        )
        .type(zip ? 'application/zip' : contentType);
      await pipeline(output, response);
    } catch (error) {
      if (response.headersSent) {
        response.destroy(error);
        return;
      }
      next(error);
    }
  };

  const portableContentTypes = new Set([
    'application/json',
    'application/geo+json',
    'application/zip',
  ]);

  const receivePortableUpload = async (request, response, next) => {
    try {
      return await receiveStreamUpload(request, {
        directory: streamTransfer.uploadDirectory,
        maxUploadBytes: streamTransfer.maxUploadBytes,
        allowedContentTypes: portableContentTypes,
      });
    } catch (error) {
      if (error instanceof StreamUploadError) {
        response.status(error.statusCode).json({ error: error.message });
        return null;
      }
      next(error);
      return null;
    }
  };

  const portableServiceMethod = (service, streamingName) => {
    if (typeof service?.[streamingName] !== 'function') {
      throw new Error(
        `Streaming transfer service method is unavailable: ${streamingName}`,
      );
    }
    return service[streamingName].bind(service);
  };

  const executePortableUpload = async (
    upload,
    context,
    serviceMethod,
    operation = {},
  ) => {
    try {
      const input = await openUploadedJson(upload, {
        maxJsonBytes: streamTransfer.maxJsonBytes,
        maxZipCompressionRatio: streamTransfer.maxZipCompressionRatio,
        maxZipEntries: streamTransfer.maxZipEntries,
        signal: context.signal,
      });
      context.log('Входной поток подготовлен', {
        transport: input.transport,
        archiveEntry: input.fileName,
        uploadBytes: upload.bytes,
        expectedJsonBytes: input.expectedJsonBytes,
      });
      return await serviceMethod(input.stream, {
        ...operation,
        maxJsonBytes: streamTransfer.maxJsonBytes,
        maxItemBytes: streamTransfer.maxItemBytes,
        maxJsonDepth: streamTransfer.maxJsonDepth,
        maxJsonItems: streamTransfer.maxJsonItems,
        signal: context.signal,
        onCommit: () => context.beginCommit(),
        onProgress: (progress) => progressLog(context, progress),
      });
    } finally {
      await removeStreamUpload(upload).catch((error) => {
        context.log(
          'Не удалось удалить временный upload-файл',
          { message: error.message },
          'warning',
        );
      });
    }
  };

  router.get('/config', (_request, response) => {
    response.set('Cache-Control', 'public, max-age=300');
    response.json({ map: publicMap });
  });

  router.get('/health', async (_request, response, next) => {
    try {
      await repository.health();
      response.set('Cache-Control', 'no-store');
      response.json({ status: 'ok', database: 'reachable' });
    } catch (error) {
      next(error);
    }
  });

  router.get('/cities', async (_request, response, next) => {
    try {
      const cities = await repository.listCities();
      // Category and rank are derived from mutable project thresholds and
      // materialized report values. Never let a browser keep the old
      // classification after the administrator saves new criteria.
      response.set('Cache-Control', 'no-store');
      response.json({ cities });
    } catch (error) {
      next(error);
    }
  });

  router.get('/cities/:cityId/geometries', async (request, response, next) => {
    const cityId = Number(request.params.cityId);
    if (!Number.isSafeInteger(cityId) || cityId <= 0) {
      response.status(400).json({ error: 'cityId must be a positive integer' });
      return;
    }
    try {
      const geojson = await repository.getCityGeometries(cityId);
      if (!geojson) {
        response.status(404).json({ error: 'City not found' });
        return;
      }
      response.set('Cache-Control', 'public, max-age=3600');
      response.json(geojson);
    } catch (error) {
      next(error);
    }
  });

  router.get('/geometries', async (request, response, next) => {
    const bbox = parseCoordinates(request.query.bbox, 4);
    if (
      !bbox ||
      bbox[0] < -180 || bbox[2] > 180 ||
      bbox[1] < -90 || bbox[3] > 90 ||
      bbox[0] >= bbox[2] || bbox[1] >= bbox[3] ||
      bbox[2] - bbox[0] > 20 || bbox[3] - bbox[1] > 20
    ) {
      response.status(400).json({
        error: 'bbox must be a WGS84 visible window with a maximum 20 degree span',
      });
      return;
    }

    const center = request.query.center === undefined
      ? [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2]
      : parseCoordinates(request.query.center, 2);
    if (
      !center ||
      center[0] < bbox[0] || center[0] > bbox[2] ||
      center[1] < bbox[1] || center[1] > bbox[3]
    ) {
      response.status(400).json({ error: 'center must be lng,lat inside bbox' });
      return;
    }

    try {
      const geojson = await repository.getViewportGeometries({
        west: bbox[0],
        south: bbox[1],
        east: bbox[2],
        north: bbox[3],
        centerLng: center[0],
        centerLat: center[1],
      });
      response.set('Cache-Control', 'no-store');
      response.json(geojson);
    } catch (error) {
      next(error);
    }
  });

  const cityStream = exportRepository?.streamCityBoundaries?.bind(
    exportRepository,
  );
  const lineStream = exportRepository?.streamLines?.bind(exportRepository);
  const populationStream = exportRepository?.streamPopulations?.bind(
    exportRepository,
  );

  router.get(
    '/admin/export/cities',
    adminAuth.requireData,
    operationAudit('data.export.cities'),
    streamingExportRoute(
      'cities.geojson',
      'application/geo+json',
      cityStream,
      () => exportRepository.exportCityBoundaries(),
    ),
  );
  router.get(
    '/admin/export/cities.zip',
    adminAuth.requireData,
    operationAudit('data.export.cities-zip'),
    streamingExportRoute(
      'cities.geojson',
      'application/geo+json',
      cityStream,
      () => exportRepository.exportCityBoundaries(),
      true,
    ),
  );
  router.get(
    '/admin/export/lines',
    adminAuth.requireData,
    operationAudit('data.export.lines'),
    streamingExportRoute(
      'lines.geojson',
      'application/geo+json',
      lineStream,
      () => exportRepository.exportLines(),
    ),
  );
  router.get(
    '/admin/export/lines.zip',
    adminAuth.requireData,
    operationAudit('data.export.lines-zip'),
    streamingExportRoute(
      'lines.geojson',
      'application/geo+json',
      lineStream,
      () => exportRepository.exportLines(),
      true,
    ),
  );
  router.get(
    '/admin/export/populations',
    adminAuth.requireData,
    operationAudit('data.export.populations'),
    streamingExportRoute(
      'populations.json',
      'application/json',
      populationStream,
      () => exportRepository.exportPopulations(),
    ),
  );
  router.get(
    '/admin/export/populations.zip',
    adminAuth.requireData,
    operationAudit('data.export.populations-zip'),
    streamingExportRoute(
      'populations.json',
      'application/json',
      populationStream,
      () => exportRepository.exportPopulations(),
      true,
    ),
  );

  const importLines = async (request, response, next) => {
    const upload = await receivePortableUpload(request, response, next);
    if (!upload) return;
    const task = startAdminTask(request, response, next, {
      type: 'geojson-import',
      endpoint: '/api/admin/import/lines',
      recordsSuccessfulUpdate: true,
      parameters: {
        transport: upload.contentType,
        contentEncoding: upload.contentEncoding,
        uploadBytes: upload.bytes,
        uploadSha256: upload.sha256,
      },
    }, async (context) => executePortableUpload(
      upload,
      context,
      portableServiceMethod(
        importService,
        'replaceFromGeoJsonStream',
      ),
    ));
    if (!task) await removeStreamUpload(upload).catch(() => {});
  };
  router.post(
    '/admin/import',
    adminAuth.requireData,
    rejectWhileAdminTaskActive,
    clearCompletedAdminTask,
    importLines,
  );
  router.post(
    '/admin/import/lines',
    adminAuth.requireData,
    rejectWhileAdminTaskActive,
    clearCompletedAdminTask,
    importLines,
  );

  router.post(
    '/admin/import/cities',
    adminAuth.requireData,
    rejectWhileAdminTaskActive,
    clearCompletedAdminTask,
    async (request, response, next) => {
      const dryRun = parseBoolean(request.query.dryRun, false);
      if (dryRun === null) {
        response.status(400).json({ error: 'dryRun must be true or false' });
        return;
      }
      const upload = await receivePortableUpload(request, response, next);
      if (!upload) return;
      const task = startAdminTask(request, response, next, {
        type: 'city-geojson-import',
        endpoint: '/api/admin/import/cities',
        recordsSuccessfulUpdate: !dryRun,
        parameters: {
          dryRun,
          transport: upload.contentType,
          contentEncoding: upload.contentEncoding,
          uploadBytes: upload.bytes,
          uploadSha256: upload.sha256,
        },
      }, async (context) => executePortableUpload(
        upload,
        context,
        portableServiceMethod(
          cityBoundaryTransferService,
          'replaceFromGeoJsonStream',
        ),
        { dryRun },
      ));
      if (!task) await removeStreamUpload(upload).catch(() => {});
    },
  );

  router.post(
    '/admin/update',
    adminAuth.requireData,
    rejectWhileAdminTaskActive,
    clearCompletedAdminTask,
    jsonBody(kmlUpdate.maxRequestBodyBytes, 'application/json'),
    (request, response, next) => {
      const hasRequestBody =
        request.get('transfer-encoding') !== undefined ||
        Number(request.get('content-length') ?? 0) > 0;
      if (hasRequestBody && request.body === undefined) {
        response.status(415).json({ error: 'Content-Type must be application/json' });
        return;
      }
      try {
        const options = resolveKmlUpdateRequest(
          request.body,
          request.query,
          kmlUpdate,
        );
        startAdminTask(request, response, next, {
          type: 'kml-update',
          endpoint: '/api/admin/update',
          recordsSuccessfulUpdate: !options.dryRun,
          parameters: {
            dryRun: options.dryRun,
            sourceCount: options.sources.length,
            cityBufferMeters: options.cityBufferMeters,
            ...(request.body !== undefined
              ? { payload: adminAuditPayloadFingerprint(request.body) }
              : {}),
          },
        }, async (context) => kmlUpdateService.update(
          request.body,
          request.query,
          {
            signal: context.signal,
            onCommit: () => context.beginCommit(),
            onProgress: (progress) => progressLog(context, progress),
          },
        ));
      } catch (error) {
        if (error instanceof KmlUpdateValidationError) {
          response.status(400).json({ error: error.message });
          return;
        }
        next(error);
      }
    },
  );

  router.get(
    '/admin/osm-checkpoint',
    adminAuth.requireData,
    async (_request, response, next) => {
      try {
        const checkpoint = await osmCityUpdateService.checkpointStatus();
        response.set('Cache-Control', 'no-store');
        response.json({ checkpoint });
      } catch (error) {
        next(error);
      }
    },
  );

  router.delete(
    '/admin/osm-checkpoint',
    adminAuth.requireData,
    rejectWhileAdminTaskActive,
    operationAudit('data.osm-checkpoint.discard'),
    async (_request, response, next) => {
      try {
        const checkpoint = await osmCityUpdateService.discardCheckpoint();
        response.set('Cache-Control', 'no-store');
        response.json({
          discarded: Boolean(checkpoint),
          checkpoint,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/admin/update/cities',
    adminAuth.requireData,
    rejectWhileAdminTaskActive,
    clearCompletedAdminTask,
    jsonBody(osmCityUpdate.maxRequestBodyBytes, 'application/json'),
    (request, response, next) => {
      const hasRequestBody =
        request.get('transfer-encoding') !== undefined ||
        Number(request.get('content-length') ?? 0) > 0;
      if (hasRequestBody && request.body === undefined) {
        response.status(415).json({ error: 'Content-Type must be application/json' });
        return;
      }
      try {
        const options = resolveOsmCityUpdateRequest(
          request.body,
          request.query,
          osmCityUpdate,
        );
        const resume = parseBoolean(request.query.resume, false);
        const restart = parseBoolean(request.query.restart, false);
        if (resume === null || restart === null) {
          response.status(400).json({
            error: 'resume and restart must be true or false',
          });
          return;
        }
        if (resume && restart) {
          response.status(400).json({
            error: 'resume and restart cannot both be true',
          });
          return;
        }
        startAdminTask(request, response, next, {
          type: 'osm-city-update',
          endpoint: '/api/admin/update/cities',
          recordsSuccessfulUpdate: !options.dryRun,
          parameters: {
            dryRun: options.dryRun,
            resume,
            restart,
            batchSize: options.batchSize,
            minDelayMs: options.minDelayMs,
            maxRetries: options.maxRetries,
            retryBaseDelayMs: options.retryBaseDelayMs,
            retryMaxDelayMs: options.retryMaxDelayMs,
            sourceURL: options.url,
            ...(request.body !== undefined
              ? { payload: adminAuditPayloadFingerprint(request.body) }
              : {}),
          },
        }, async (context) => osmCityUpdateService.update(
          request.body,
          request.query,
          {
            signal: context.signal,
            onCommit: () => context.beginCommit(),
            onProgress: (progress) => progressLog(context, progress),
          },
        ));
      } catch (error) {
        if (error instanceof OsmCityUpdateValidationError) {
          response.status(400).json({ error: error.message });
          return;
        }
        next(error);
      }
    },
  );

  router.get(
    '/admin/config',
    adminAuth.requireData,
    (_request, response) => {
      response.set('Cache-Control', 'no-store');
      response.json({
        transfer: {
          requestCompression: ['gzip', 'deflate', 'br'],
          responseCompression: 'Accept-Encoding negotiation',
          portableFormats: ['json', 'zip-single-file'],
          streaming: true,
          zip: {
            entries: 1,
            zip64: false,
            compressionMethods: ['store', 'deflate'],
          },
          limits: {
            uploadBytes: streamTransfer.maxUploadBytes,
            decodedJsonBytes: streamTransfer.maxJsonBytes,
            itemBytes: streamTransfer.maxItemBytes,
          },
        },
        osmCityUpdate: {
          allowedURLs: [...osmCityUpdate.allowedURLs],
          defaults: {
            URL: osmCityUpdate.url,
            batchSize: osmCityUpdate.batchSize,
            minDelayMs: osmCityUpdate.minDelayMs,
            maxRetries: osmCityUpdate.maxRetries,
            retryBaseDelayMs: osmCityUpdate.retryBaseDelayMs,
            retryMaxDelayMs: osmCityUpdate.retryMaxDelayMs,
          },
          limits: {
            batchSize: { min: 1, max: osmCityUpdate.maxBatchSize },
            minDelayMs: { min: osmCityUpdate.minDelayMs, max: 300000 },
            maxRetries: { min: 0, max: osmCityUpdate.maxRetries },
            retryBaseDelayMs: {
              min: osmCityUpdate.retryBaseDelayMs,
              max: 3600000,
            },
            retryMaxDelayMs: {
              min: osmCityUpdate.retryMaxDelayMs,
              max: 3600000,
            },
          },
        },
        kmlUpdate: {
          defaults: { cityBufferMeters: kmlUpdate.cityBufferMeters },
          limits: {
            cityBufferMeters: {
              min: 0,
              max: kmlUpdate.cityBufferMaxMeters,
            },
          },
        },
      });
    },
  );

  router.get(
    '/admin/status',
    adminAuth.requireData,
    (request, response) => {
      const task = adminTasks.current();
      response.set('Cache-Control', 'no-store');
      response.json({
        status: task?.status ?? 'idle',
        taskId: task?.id ?? null,
        task: task ? {
          ...task,
          statusURL: adminStatusURL(request, task.id),
        } : null,
        lastSuccessfulUpdates: adminTasks.successfulUpdates(),
      });
    },
  );

  router.get(
    '/admin/status/:taskId',
    adminAuth.requireData,
    (request, response) => {
      const task = adminTasks.get(request.params.taskId);
      if (!task) {
        response.status(404).json({ error: 'Admin task not found' });
        return;
      }
      response.set('Cache-Control', 'no-store');
      response.json({
        status: task.status,
        taskId: task.id,
        lastSuccessfulUpdates: adminTasks.successfulUpdates(),
        task: {
          ...task,
          statusURL: adminStatusURL(request, task.id),
        },
      });
    },
  );

  const cancelAdminTask = (request, response) => {
    const taskId = request.params.taskId ?? adminTasks.active()?.id;
    if (!taskId) {
      response.status(404).json({ error: 'Active admin task not found' });
      return;
    }
    const cancellation = adminTasks.cancel(taskId);
    if (!cancellation) {
      response.status(404).json({ error: 'Admin task not found' });
      return;
    }
    const statusURL = adminStatusURL(request, taskId);
    response.set('Cache-Control', 'no-store');
    if (!cancellation.accepted) {
      response.status(409).json({
        error: 'Admin task is not active',
        taskId,
        status: cancellation.task.status,
        statusURL,
      });
      return;
    }
    response.status(202).json({ status: 'cancelling', statusURL, taskId });
  };

  router.post(
    '/admin/cancel',
    adminAuth.requireData,
    operationAudit('data.task.cancel'),
    cancelAdminTask,
  );
  router.post(
    '/admin/cancel/:taskId',
    adminAuth.requireData,
    operationAudit('data.task.cancel'),
    cancelAdminTask,
  );

  router.post(
    '/admin/populations',
    adminAuth.requireData,
    rejectWhileAdminTaskActive,
    clearCompletedAdminTask,
    async (request, response, next) => {
      const upload = await receivePortableUpload(request, response, next);
      if (!upload) return;
      const task = startAdminTask(request, response, next, {
        type: 'population-update',
        endpoint: '/api/admin/populations',
        recordsSuccessfulUpdate: true,
        parameters: {
          transport: upload.contentType,
          contentEncoding: upload.contentEncoding,
          uploadBytes: upload.bytes,
          uploadSha256: upload.sha256,
        },
      }, async (context) => executePortableUpload(
        upload,
        context,
        portableServiceMethod(
          populationService,
          'updateFromJsonStream',
        ),
      ));
      if (!task) await removeStreamUpload(upload).catch(() => {});
    },
  );

  return router;
}
