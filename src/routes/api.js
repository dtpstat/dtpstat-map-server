import express, {Router}        from 'express';
import {
	AdminTaskAlreadyRunningError,
} from '../data/admin-task-manager.js';
import {
	KmlUpdateValidationError,
	resolveKmlUpdateRequest,
} from '../data/kml-update-options.js';
import {
	OsmCityUpdateValidationError,
	resolveOsmCityUpdateRequest,
} from '../data/osm-city-update-options.js';
import {createBasicAuth}        from '../http/basic-auth.js';

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

/**
 * @typedef {{ replaceFromGeoJson: (collection: unknown, operation?: object) => Promise<object> }} DataImportService
 */

/**
 * @typedef {{ replaceFromGeoJson: (collection: unknown, operation?: object) => Promise<object> }} CityBoundaryTransferService
 */

/**
 * @typedef {{ updateFromJson: (payload: unknown, operation?: object) => Promise<object> }} PopulationImportService
 */

/**
 * @typedef {{ update: (body: unknown, query: Record<string, unknown>, operation?: object) => Promise<object> }} KmlUpdateService
 */

/**
 * @typedef {{ update: (body: unknown, query: Record<string, unknown>, operation?: object) => Promise<object> }} OsmCityUpdateService
 */

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
 *   publicMap: object,
 *   importApi: { username: string, password: string, maxBodyBytes: number },
 *   kmlUpdate: { maxRequestBodyBytes: number },
 *   osmCityUpdate: { maxRequestBodyBytes: number }
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
	                                publicMap,
	                                importApi,
	                                kmlUpdate,
	                                osmCityUpdate,
                                }){
	const router            = Router();
	const requireImportAuth = createBasicAuth({
		username: importApi.username,
		password: importApi.password,
	});
	const adminStatusURL = (request, taskId) =>
		`${request.baseUrl}/admin/status/${taskId}`;
	const respondWithActiveTask = (request, response, task) => {
		const statusURL = adminStatusURL(request, task.id);
		response.set('Cache-Control', 'no-store');
		response.status(409).json({
			error: 'Another admin task is already active',
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
		if(activeTask){
			respondWithActiveTask(request, response, activeTask);
			return;
		}
		next();
	};
	const progressLog = (context, progress) => {
		let message = `Прогресс: ${progress.phase}`;
		if(progress.phase === 'index'){
			message = `OSM: загружена часть индекса ${progress.indexPart}/${progress.indexPartCount}`;
		}else if(progress.phase === 'geometry'){
			message = `OSM: обработан пакет ${progress.batch}/${progress.batchCount}`;
		}else if(progress.phase === 'retry'){
			const target = progress.requestPhase === 'geometry'
				? `пакет ${progress.batch}/${progress.batchCount}`
				: `часть индекса ${progress.indexPart}/${progress.indexPartCount}`;
			message = `OSM: HTTP ${progress.statusCode}, ${target}; повтор ${progress.attempt}/${progress.maxRetries} через ${Math.ceil(progress.waitMs / 1000)} сек.`;
		}else if(progress.phase === 'kml-source'){
			message = `KML: обработан источник ${progress.source}/${progress.sourceCount}`;
		}else if(progress.phase === 'validated'){
			message = 'Входные данные проверены';
		}else if(progress.phase === 'database'){
			message = 'Изменения базы данных подготовлены';
		}
		context.log(message, progress);
	};
	const parseCoordinates = (value, count) => {
		if(typeof value !== 'string') return null;
		const parts = value.split(',');
		if(parts.length !== count || parts.some((part) => part.trim() === '')){
			return null;
		}
		const coordinates = parts.map((part) => Number(part));
		return coordinates.every(Number.isFinite) ? coordinates : null;
	};
	const parseBoolean = (value, fallback = false) => {
		if(value === undefined) return fallback;
		if(value === 'true' || value === true) return true;
		if(value === 'false' || value === false) return false;
		return null;
	};
	const startAdminTask = (request, response, next, definition, executor) => {
		try{
			const task = adminTasks.start(definition, executor);
			const statusURL = adminStatusURL(request, task.id);
			response.set('Cache-Control', 'no-store');
			response.location(statusURL);
			response.status(202).json({
				status: 'accepted',
				taskId: task.id,
				task: {...task, statusURL},
			});
		}catch(error){
			if(error instanceof AdminTaskAlreadyRunningError){
				respondWithActiveTask(request, response, error.task);
				return;
			}
			next(error);
		}
	};
	const jsonBody = (limit, type) => express.json({
		limit,
		strict: true,
		inflate: true,
		type,
	});
	const sendDownload = (response, fileName, contentType, payload) => {
		response.set('Cache-Control', 'no-store');
		response.set('Content-Disposition', `attachment; filename="${fileName}"`);
		response.type(contentType).send(JSON.stringify(payload));
	};
	const exportRoute = (fileName, contentType, loader) =>
		async(_request, response, next) => {
			try{
				const payload = await loader();
				sendDownload(response, fileName, contentType, payload);
			}catch(error){
				next(error);
			}
		};

	router.get('/config', (_request, response) => {
		response.set('Cache-Control', 'public, max-age=300');
		response.json({map: publicMap});
	});

	router.get('/health', async(_request, response, next) => {
		try{
			await repository.health();
			response.set('Cache-Control', 'no-store');
			response.json({status: 'ok', database: 'reachable'});
		}catch(error){
			next(error);
		}
	});

	router.get('/cities', async(_request, response, next) => {
		try{
			const cities = await repository.listCities();
			response.set('Cache-Control', 'public, max-age=300');
			response.json({cities});
		}catch(error){
			next(error);
		}
	});

	router.get('/cities/:cityId/geometries', async(request, response, next) => {
		const cityId = Number(request.params.cityId);
		if(!Number.isSafeInteger(cityId) || cityId <= 0){
			response.status(400).json({error: 'cityId must be a positive integer'});
			return;
		}

		try{
			const geojson = await repository.getCityGeometries(cityId);
			if(!geojson){
				response.status(404).json({error: 'City not found'});
				return;
			}

			response.set('Cache-Control', 'public, max-age=3600');
			response.json(geojson);
		}catch(error){
			next(error);
		}
	});

	router.get('/geometries', async(request, response, next) => {
		const bbox = parseCoordinates(request.query.bbox, 4);
		if(
			!bbox ||
			bbox[0] < -180 || bbox[2] > 180 ||
			bbox[1] < -90 || bbox[3] > 90 ||
			bbox[0] >= bbox[2] || bbox[1] >= bbox[3] ||
			bbox[2] - bbox[0] > 20 || bbox[3] - bbox[1] > 20
		){
			response.status(400).json({
				error: 'bbox must be a WGS84 visible window with a maximum 20 degree span',
			});
			return;
		}

		const center = request.query.center === undefined
			? [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2]
			: parseCoordinates(request.query.center, 2);
		if(
			!center ||
			center[0] < bbox[0] || center[0] > bbox[2] ||
			center[1] < bbox[1] || center[1] > bbox[3]
		){
			response.status(400).json({
				error: 'center must be lng,lat inside bbox',
			});
			return;
		}

		try{
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
		}catch(error){
			next(error);
		}
	});

	router.get(
		'/admin/export/cities',
		requireImportAuth,
		exportRoute(
			'dtpstat-buslines-cities.geojson',
			'application/geo+json',
			() => exportRepository.exportCityBoundaries(),
		),
	);
	router.get(
		'/admin/export/lines',
		requireImportAuth,
		exportRoute(
			'dtpstat-buslines-lines.geojson',
			'application/geo+json',
			() => exportRepository.exportLines(),
		),
	);
	router.get(
		'/admin/export/populations',
		requireImportAuth,
		exportRoute(
			'dtpstat-buslines-populations.json',
			'application/json',
			() => exportRepository.exportPopulations(),
		),
	);

	const lineImportMiddleware = [
		requireImportAuth,
		rejectWhileAdminTaskActive,
		jsonBody(
			importApi.maxBodyBytes,
			['application/json', 'application/geo+json'],
		),
	];
	const importLines = (request, response, next) => {
		if(request.body === undefined){
			response.status(415).json({
				error: 'Content-Type must be application/json or application/geo+json',
			});
			return;
		}

		startAdminTask(request, response, next, {
			type: 'geojson-import',
			endpoint: '/api/admin/import/lines',
			recordsSuccessfulUpdate: true,
		}, async(context) => importService.replaceFromGeoJson(
			request.body,
			{
				signal: context.signal,
				onCommit: () => context.beginCommit(),
				onProgress: (progress) => progressLog(context, progress),
			},
		));
	};
	// Legacy endpoint remains available for existing scripts.
	router.post('/admin/import', ...lineImportMiddleware, importLines);
	router.post('/admin/import/lines', ...lineImportMiddleware, importLines);

	router.post(
		'/admin/import/cities',
		requireImportAuth,
		rejectWhileAdminTaskActive,
		jsonBody(
			importApi.maxBodyBytes,
			['application/json', 'application/geo+json'],
		),
		(request, response, next) => {
			if(request.body === undefined){
				response.status(415).json({
					error: 'Content-Type must be application/json or application/geo+json',
				});
				return;
			}
			const dryRun = parseBoolean(request.query.dryRun, false);
			if(dryRun === null){
				response.status(400).json({error: 'dryRun must be true or false'});
				return;
			}
			startAdminTask(request, response, next, {
				type: 'city-geojson-import',
				endpoint: '/api/admin/import/cities',
				recordsSuccessfulUpdate: !dryRun,
				parameters: {dryRun},
			}, async(context) => cityBoundaryTransferService.replaceFromGeoJson(
				request.body,
				{
					dryRun,
					signal: context.signal,
					onCommit: () => context.beginCommit(),
					onProgress: (progress) => progressLog(context, progress),
				},
			));
		},
	);

	router.post(
		'/admin/update',
		requireImportAuth,
		rejectWhileAdminTaskActive,
		jsonBody(kmlUpdate.maxRequestBodyBytes, 'application/json'),
		(request, response, next) => {
			const hasRequestBody =
				request.get('transfer-encoding') !== undefined ||
				Number(request.get('content-length') ?? 0) > 0;
			if(hasRequestBody && request.body === undefined){
				response.status(415).json({error: 'Content-Type must be application/json'});
				return;
			}

			try{
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
					},
				}, async(context) => kmlUpdateService.update(
					request.body,
					request.query,
					{
						signal: context.signal,
						onCommit: () => context.beginCommit(),
						onProgress: (progress) => progressLog(context, progress),
					},
				));
			}catch(error){
				if(error instanceof KmlUpdateValidationError){
					response.status(400).json({error: error.message});
					return;
				}
				next(error);
			}
		},
	);

	router.post(
		'/admin/update/cities',
		requireImportAuth,
		rejectWhileAdminTaskActive,
		jsonBody(osmCityUpdate.maxRequestBodyBytes, 'application/json'),
		(request, response, next) => {
			const hasRequestBody =
				request.get('transfer-encoding') !== undefined ||
				Number(request.get('content-length') ?? 0) > 0;
			if(hasRequestBody && request.body === undefined){
				response.status(415).json({error: 'Content-Type must be application/json'});
				return;
			}

			try{
				const options = resolveOsmCityUpdateRequest(
					request.body,
					request.query,
					osmCityUpdate,
				);
				startAdminTask(request, response, next, {
					type: 'osm-city-update',
					endpoint: '/api/admin/update/cities',
					recordsSuccessfulUpdate: !options.dryRun,
					parameters: {
						dryRun: options.dryRun,
						batchSize: options.batchSize,
						minDelayMs: options.minDelayMs,
						maxRetries: options.maxRetries,
						retryBaseDelayMs: options.retryBaseDelayMs,
						retryMaxDelayMs: options.retryMaxDelayMs,
						sourceURL: options.url,
					},
				}, async(context) => osmCityUpdateService.update(
					request.body,
					request.query,
					{
						signal: context.signal,
						onCommit: () => context.beginCommit(),
						onProgress: (progress) => progressLog(context, progress),
					},
				));
			}catch(error){
				if(error instanceof OsmCityUpdateValidationError){
					response.status(400).json({error: error.message});
					return;
				}
				next(error);
			}
		},
	);

	router.get(
		'/admin/config',
		requireImportAuth,
		(request, response) => {
			response.set('Cache-Control', 'no-store');
			response.json({
				transfer: {
					requestCompression: ['gzip', 'deflate', 'br'],
					responseCompression: 'Accept-Encoding negotiation',
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
						batchSize: {min: 1, max: osmCityUpdate.maxBatchSize},
						minDelayMs: {min: osmCityUpdate.minDelayMs, max: 300000},
						maxRetries: {min: 0, max: osmCityUpdate.maxRetries},
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
					defaults: {
						cityBufferMeters: kmlUpdate.cityBufferMeters,
					},
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
		requireImportAuth,
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
		requireImportAuth,
		(request, response) => {
			const task = adminTasks.get(request.params.taskId);
			if(!task){
				response.status(404).json({error: 'Admin task not found'});
				return;
			}
			response.set('Cache-Control', 'no-store');
			response.json({
				status: task.status,
				taskId: task.id,
				lastSuccessfulUpdates: adminTasks.successfulUpdates(),
				task:   {
					...task,
					statusURL: adminStatusURL(request, task.id),
				},
			});
		},
	);

	const cancelAdminTask = (request, response) => {
		const taskId = request.params.taskId ?? adminTasks.active()?.id;
		if(!taskId){
			response.status(404).json({error: 'Active admin task not found'});
			return;
		}
		const cancellation = adminTasks.cancel(taskId);
		if(!cancellation){
			response.status(404).json({error: 'Admin task not found'});
			return;
		}
		const statusURL = adminStatusURL(request, taskId);
		response.set('Cache-Control', 'no-store');
		if(!cancellation.accepted){
			response.status(409).json({
				error: 'Admin task is not active',
				taskId,
				status: cancellation.task.status,
				statusURL,
			});
			return;
		}
		response.status(202).json({
			status: 'cancelling',
			taskId,
			statusURL,
		});
	};

	router.post('/admin/cancel', requireImportAuth, cancelAdminTask);
	router.post(
		'/admin/cancel/:taskId',
		requireImportAuth,
		cancelAdminTask,
	);

	router.post(
		'/admin/populations',
		requireImportAuth,
		rejectWhileAdminTaskActive,
		jsonBody(importApi.maxBodyBytes, 'application/json'),
		(request, response, next) => {
			if(request.body === undefined){
				response.status(415).json({
					error: 'Content-Type must be application/json',
				});
				return;
			}

			startAdminTask(request, response, next, {
				type: 'population-update',
				endpoint: '/api/admin/populations',
				recordsSuccessfulUpdate: true,
			}, async(context) => populationService.updateFromJson(
				request.body,
				{
					signal: context.signal,
					onCommit: () => context.beginCommit(),
					onProgress: (progress) => progressLog(context, progress),
				},
			));
		},
	);

	return router;
}
