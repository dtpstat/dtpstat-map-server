import 'dotenv/config';
import path from 'node:path';
import {createApp}                 from './app.js';
import {loadConfig}                from './config.js';
import {createAdminTaskManager}    from './data/admin-task-manager.js';
import {createPublicDownloadService} from './data/public-download-service.js';
import {createAdminTaskSuccessRepository} from './db/admin-task-success-repository.js';
import {createCitiesRepository}    from './db/cities-repository.js';
import {createCityBoundaryTransferService} from './db/city-boundary-transfer-service.js';
import {createDataExportRepository} from './db/data-export-repository.js';
import {createDataImportService}   from './db/data-import-service.js';
import {createKmlUpdateService}    from './db/kml-update-service.js';
import {createLineTypesRepository} from './db/line-types-repository.js';
import {createOsmCityUpdateService} from './db/osm-city-update-service.js';
import {createPopulationImportService} from './db/population-import-service.js';
import {createProjectSettingsRepository} from './db/project-settings-repository.js';
import {createPublicDownloadRepository} from './db/public-download-repository.js';
import {createPool}                from './db/pool.js';
import {closeServer, startServers} from './http/start-servers.js';
import {createAdminWebSocketGateway} from './http/admin-websocket.js';

const PUBLIC_DOWNLOAD_TASK_TYPES = new Set([
	'geojson-import',
	'city-geojson-import',
	'kml-update',
	'osm-city-update',
	'population-update',
]);

async function main(){
	const config     = loadConfig();
	const pool       = createPool(config.database);
	const repository = createCitiesRepository(pool);
	const lineTypesRepository = createLineTypesRepository(pool);
	const projectSettingsRepository = createProjectSettingsRepository(pool);
	const exportRepository = createDataExportRepository(pool);
	const publicDownloadRepository = createPublicDownloadRepository(pool);
	const publicDownloadService = createPublicDownloadService({
		repository: publicDownloadRepository,
		directory: path.join(config.projectRoot, 'var', 'public-downloads'),
	});
	const importService = createDataImportService(pool);
	const cityBoundaryTransferService = createCityBoundaryTransferService(pool);
	const populationService = createPopulationImportService(pool);
	const kmlUpdateService = createKmlUpdateService(pool, config.kmlUpdate);
	const osmCityUpdateService = createOsmCityUpdateService(
		pool,
		config.osmCityUpdate,
	);
	const adminTaskSuccessRepository = createAdminTaskSuccessRepository(pool);

	await repository.health();
	await projectSettingsRepository.get();
	const initialPublicDownloads = await publicDownloadService.refresh();
	console.info('Public download snapshots refreshed', initialPublicDownloads);
	const initialSuccessfulUpdates = await adminTaskSuccessRepository.list();
	const adminTasks = createAdminTaskManager({
		initialSuccessfulUpdates,
		recordSuccessfulUpdate: (update) =>
			adminTaskSuccessRepository.record(update),
		afterSuccessfulUpdate: (update) => {
			if(!PUBLIC_DOWNLOAD_TASK_TYPES.has(update.taskType)) return undefined;
			return publicDownloadService.refresh();
		},
	});
	const adminWebSocket = createAdminWebSocketGateway({
		adminTasks,
		importApi: config.importApi,
	});

	const app        = createApp({
		repository,
		lineTypesRepository,
		projectSettingsRepository,
		exportRepository,
		importService,
		cityBoundaryTransferService,
		populationService,
		kmlUpdateService,
		osmCityUpdateService,
		adminTasks,
		config,
	});
	const servers    = await startServers({
		app,
		config,
		webSocketGateway: adminWebSocket,
	});
	let shuttingDown = false;

	async function shutdown(signal){
		if(shuttingDown){
			return;
		}
		shuttingDown = true;
		console.log(`Received ${signal}; shutting down`);

		await adminWebSocket.close();
		await Promise.allSettled(servers.map((server) => closeServer(server)));
		await pool.end();
	}

	for(const signal of ['SIGINT', 'SIGTERM']){
		process.once(signal, () => {
			shutdown(signal)
				.then(() => process.exit(0))
				.catch((error) => {
					console.error('Graceful shutdown failed', error);
					process.exit(1);
				});
		});
	}
}

main().catch((error) => {
	console.error('Server failed to start', error);
	process.exitCode = 1;
});
