import compression       from 'compression';
import express           from 'express';
import helmet            from 'helmet';
import {readFileSync}     from 'node:fs';
import path               from 'node:path';
import {CITY_MARKER_ICON} from '../public/js/city-marker-icon.js';
import {createAdminTaskManager} from './data/admin-task-manager.js';
import {createBasicAuth} from './http/basic-auth.js';
import {projectManifest, renderProjectPage} from './http/project-page.js';
import {createApiRouter} from './routes/api.js';
import {createLineTypesRouter} from './routes/line-types-api.js';
import {createProjectSettingsRouter} from './routes/project-settings-api.js';

const PUBLIC_ASSETS = new Map([
	['/favicon.ico', 'favicon.ico'],
	['/favicon-16x16.png', 'favicon-16x16.png'],
	['/favicon-32x32.png', 'favicon-32x32.png'],
	['/apple-touch-icon.png', 'apple-touch-icon.png'],
	['/android-chrome-192x192.png', 'android-chrome-192x192.png'],
	['/android-chrome-512x512.png', 'android-chrome-512x512.png'],
	['/bus-lanes.jpeg', 'bus-lanes.jpeg'],
	['/bus-lanes.csv', 'bus-lanes.csv'],
	['/bus-lanes.geojson', 'bus-lanes.geojson'],
]);
const CITY_MARKER_PNG = Buffer.from(CITY_MARKER_ICON.split(',')[1], 'base64');
const TEST_PROJECT_SETTINGS = Object.freeze({
	projectName: 'Выделенные полосы в России',
	keywords: ['выделенные полосы', 'общественный транспорт'],
	footerHtml: '<h2>О проекте</h2><p>Тестовые настройки проекта.</p>',
	yandexMetrikaId: null,
	googleAnalyticsId: null,
	updatedAt: '2026-01-01T00:00:00.000Z',
});

function testProjectSettingsRepository(){
	let settings = {...TEST_PROJECT_SETTINGS};
	return {
		async get(){ return settings; },
		async save(payload){
			settings = {
				...payload,
				updatedAt: new Date().toISOString(),
			};
			return settings;
		},
	};
}

/**
 * @param {{
 *   repository: import('./routes/api.js').CitiesRepository,
 *   lineTypesRepository: { list: () => Promise<any[]>, save: (payload: unknown) => Promise<any[]> },
 *   projectSettingsRepository?: { get: () => Promise<any>, save: (payload: unknown) => Promise<any> },
 *   exportRepository: import('./routes/api.js').DataExportRepository,
 *   importService: import('./routes/api.js').DataImportService,
 *   cityBoundaryTransferService: import('./routes/api.js').CityBoundaryTransferService,
 *   populationService: import('./routes/api.js').PopulationImportService,
 *   kmlUpdateService: import('./routes/api.js').KmlUpdateService,
 *   osmCityUpdateService: import('./routes/api.js').OsmCityUpdateService,
 *   adminTasks?: ReturnType<typeof createAdminTaskManager>,
 *   config: any
 * }} dependencies
 */
export function createApp({
	repository,
	lineTypesRepository,
	projectSettingsRepository,
	exportRepository,
	importService,
	cityBoundaryTransferService,
	populationService,
	kmlUpdateService,
	osmCityUpdateService,
	adminTasks = createAdminTaskManager(),
	config,
}){
	const app             = express();
	const isProduction    = config.environment === 'production';
	const effectiveProjectSettingsRepository = projectSettingsRepository ??
		(config.environment === 'test' ? testProjectSettingsRepository() : null);
	if(!effectiveProjectSettingsRepository){
		throw new Error('projectSettingsRepository is required');
	}
	const publicDirectory = path.join(config.projectRoot, 'public');
	const adminDirectory  = path.join(config.projectRoot, 'admin');
	const publicPageTemplate = readFileSync(
		path.join(config.projectRoot, 'index.html'),
		'utf8',
	);
	const requireAdminAuth = createBasicAuth({
		username: config.importApi.username,
		password: config.importApi.password,
		realm: 'data-import',
	});

	app.disable('x-powered-by');
	app.use(
		helmet({
			crossOriginEmbedderPolicy: false,
			contentSecurityPolicy:     {
				directives: {
					defaultSrc: ["'self'"],
					scriptSrc:  [
						"'self'",
						"'wasm-unsafe-eval'",
						'https://mc.yandex.ru',
						'https://yastatic.net',
						'https://*.googletagmanager.com',
					],
					styleSrc:   ["'self'", "'unsafe-inline'"],
					imgSrc:     [
						"'self'",
						'data:',
						'blob:',
						'https://*.mapbox.com',
						'https://mc.yandex.ru',
						'https://*.google-analytics.com',
						'https://*.googletagmanager.com',
					],
					connectSrc: [
						"'self'",
						'ws:',
						'wss:',
						'https://*.mapbox.com',
						'https://mc.yandex.ru',
						'wss://mc.yandex.ru',
						'https://*.google-analytics.com',
						'https://*.analytics.google.com',
						'https://*.googletagmanager.com',
					],
					workerSrc:  ["'self'", 'blob:'],
					childSrc:   ["'self'", 'blob:', 'https://mc.yandex.ru'],
					frameSrc:   ["'self'", 'blob:', 'https://mc.yandex.ru'],
				},
			},
		}),
	);
	app.use(compression());
	app.get('/images/city-marker.png', (_request, response) => {
		response
			.set('Cache-Control', isProduction ? 'public, max-age=86400' : 'no-cache')
			.type('image/png')
			.send(CITY_MARKER_PNG);
	});
	app.use(
		'/admin',
		requireAdminAuth,
		express.static(adminDirectory, {
			index: 'index.html',
			maxAge: isProduction ? '5m' : 0,
		}),
	);

	app.use(
		'/vendor/mapbox-gl',
		express.static(path.join(config.projectRoot, 'node_modules/mapbox-gl/dist'), {
			immutable: isProduction,
			maxAge:    isProduction ? '30d' : 0,
		}),
	);
	app.use(
		express.static(publicDirectory, {
			index:  false,
			maxAge: isProduction ? '1h' : 0,
		}),
	);

	app.use(
		'/api',
		createLineTypesRouter({
			lineTypesRepository,
			adminTasks,
			importApi: config.importApi,
		}),
	);
	app.use(
		'/api',
		createProjectSettingsRouter({
			projectSettingsRepository: effectiveProjectSettingsRepository,
			adminTasks,
			importApi: config.importApi,
		}),
	);
	app.use(
		'/api',
		createApiRouter({
			repository,
			exportRepository,
			importService,
			cityBoundaryTransferService,
			populationService,
			kmlUpdateService,
			osmCityUpdateService,
			adminTasks,
			publicMap: config.publicMap,
			importApi: config.importApi,
			kmlUpdate: config.kmlUpdate,
			osmCityUpdate: config.osmCityUpdate,
		}),
	);

	for(const [route, fileName] of PUBLIC_ASSETS){
		app.get(route, (_request, response) => {
			response.sendFile(fileName, {root: config.projectRoot});
		});
	}

	app.get('/site.webmanifest', async (_request, response, next) => {
		try {
			const settings = await effectiveProjectSettingsRepository.get();
			response
				.set('Cache-Control', 'no-cache')
				.type('application/manifest+json')
				.send(JSON.stringify(projectManifest(settings)));
		} catch (error) {
			next(error);
		}
	});

	app.get('/', async (_request, response, next) => {
		try {
			const settings = await effectiveProjectSettingsRepository.get();
			response
				.set('Cache-Control', 'no-cache')
				.type('html')
				.send(renderProjectPage(publicPageTemplate, settings));
		} catch (error) {
			next(error);
		}
	});

	app.use((request, response) => {
		if(request.path.startsWith('/api/')){
			response.status(404).json({error: 'API endpoint not found'});
			return;
		}
		response.status(404).type('text').send('Not found');
	});

	app.use((error, request, response, _next) => {
		if(error?.type === 'entity.too.large'){
			response.status(413).json({error: 'Request body is too large'});
			return;
		}
		if(error?.type === 'entity.parse.failed'){
			response.status(400).json({error: 'Request body is not valid JSON'});
			return;
		}
		if(error?.status === 415 || error?.type === 'encoding.unsupported'){
			response.status(415).json({error: error.message || 'Unsupported content encoding'});
			return;
		}

		console.error('Request failed', {
			method: request.method,
			path:   request.path,
			error:  error instanceof Error ? error.message : String(error),
		});
		response.status(503).json({error: 'Service temporarily unavailable'});
	});

	return app;
}