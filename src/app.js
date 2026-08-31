import compression       from 'compression';
import express           from 'express';
import helmet            from 'helmet';
import path              from 'node:path';
import {createApiRouter} from './routes/api.js';

const PUBLIC_ASSETS = new Map([
	['/favicon.ico', 'favicon.ico'],
	['/favicon-16x16.png', 'favicon-16x16.png'],
	['/favicon-32x32.png', 'favicon-32x32.png'],
	['/apple-touch-icon.png', 'apple-touch-icon.png'],
	['/android-chrome-192x192.png', 'android-chrome-192x192.png'],
	['/android-chrome-512x512.png', 'android-chrome-512x512.png'],
	['/site.webmanifest', 'site.webmanifest'],
	['/bus-lanes.jpeg', 'bus-lanes.jpeg'],
	['/bus-lanes.csv', 'bus-lanes.csv'],
	['/bus-lanes.geojson', 'bus-lanes.geojson'],
]);

/**
 * @param {{
 *   repository: import('./routes/api.js').CitiesRepository,
 *   importService: import('./routes/api.js').DataImportService,
 *   populationService: import('./routes/api.js').PopulationImportService,
 *   config: any
 * }} dependencies
 */
export function createApp({repository, importService, populationService, config}){
	const app             = express();
	const isProduction    = config.environment === 'production';
	const publicDirectory = path.join(config.projectRoot, 'public');

	app.disable('x-powered-by');
	app.use(
		helmet({
			crossOriginEmbedderPolicy: false,
			contentSecurityPolicy:     {
				directives: {
					defaultSrc: ["'self'"],
					scriptSrc:  ["'self'", "'wasm-unsafe-eval'"],
					styleSrc:   ["'self'", "'unsafe-inline'"],
					imgSrc:     ["'self'", 'data:', 'blob:', 'https://*.mapbox.com'],
					connectSrc: ["'self'", 'https://*.mapbox.com'],
					workerSrc:  ["'self'", 'blob:'],
					childSrc:   ["'self'", 'blob:'],
				},
			},
		}),
	);
	app.use(compression());

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
		createApiRouter({
			repository,
			importService,
			populationService,
			publicMap: config.publicMap,
			importApi: config.importApi,
		}),
	);

	for(const [route, fileName] of PUBLIC_ASSETS){
		app.get(route, (_request, response) => {
			response.sendFile(fileName, {root: config.projectRoot});
		});
	}

	app.get('/', (_request, response) => {
		response.sendFile('index.html', {root: config.projectRoot});
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

		console.error('Request failed', {
			method: request.method,
			path:   request.path,
			error:  error instanceof Error ? error.message : String(error),
		});
		response.status(503).json({error: 'Service temporarily unavailable'});
	});

	return app;
}
