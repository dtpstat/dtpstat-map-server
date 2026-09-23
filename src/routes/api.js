import express, { Router } from 'express';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  AdminTaskAlreadyRunningError,
} from '../data/admin-task-manager.js';
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
import {
  registerAdminTaskRoutes,
} from '../application/admin-tasks/routes.js';
import {
  registerDataExportRoutes,
  registerDataImportRoutes,
  registerPopulationRoutes,
} from '../application/data-transfer/routes.js';
import { registerLineRoutes } from '../modules/lines/routes.js';
import { registerMapRoutes } from '../modules/map/routes.js';
import { registerOsmRoutes } from '../modules/osm/routes.js';

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

  registerMapRoutes(router, {
    repository,
    publicMap,
    parseCoordinates,
  });

  registerDataExportRoutes(router, {
    exportRepository,
    adminAuth,
    operationAudit,
    streamingExportRoute,
  });

  registerDataImportRoutes(router, {
    importService,
    cityBoundaryTransferService,
    adminAuth,
    rejectWhileAdminTaskActive,
    clearCompletedAdminTask,
    receivePortableUpload,
    startAdminTask,
    executePortableUpload,
    portableServiceMethod,
    removeStreamUpload,
    parseBoolean,
  });

  registerLineRoutes(router, {
    adminAuth,
    rejectWhileAdminTaskActive,
    clearCompletedAdminTask,
    jsonBody,
    kmlUpdate,
    startAdminTask,
    kmlUpdateService,
    progressLog,
  });

  registerOsmRoutes(router, {
    adminAuth,
    rejectWhileAdminTaskActive,
    clearCompletedAdminTask,
    operationAudit,
    jsonBody,
    osmCityUpdate,
    osmCityUpdateService,
    startAdminTask,
    parseBoolean,
    progressLog,
  });

  registerAdminTaskRoutes(router, {
    adminAuth,
    operationAudit,
    adminTasks,
    adminStatusURL,
    streamTransfer,
    osmCityUpdate,
    kmlUpdate,
  });

  registerPopulationRoutes(router, {
    populationService,
    adminAuth,
    rejectWhileAdminTaskActive,
    clearCompletedAdminTask,
    receivePortableUpload,
    startAdminTask,
    executePortableUpload,
    portableServiceMethod,
    removeStreamUpload,
  });

  return router;
}
