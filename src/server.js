import 'dotenv/config';
import {createApp}                 from './app.js';
import {loadConfig}                from './config.js';
import {createCitiesRepository}    from './db/cities-repository.js';
import {createDataImportService}   from './db/data-import-service.js';
import {createPopulationImportService} from './db/population-import-service.js';
import {createPool}                from './db/pool.js';
import {closeServer, startServers} from './http/start-servers.js';

async function main(){
	const config     = loadConfig();
	const pool       = createPool(config.database);
	const repository = createCitiesRepository(pool);
	const importService = createDataImportService(pool);
	const populationService = createPopulationImportService(pool);

	await repository.health();

	const app        = createApp({
		repository,
		importService,
		populationService,
		config,
	});
	const servers    = await startServers({app, config});
	let shuttingDown = false;

	async function shutdown(signal){
		if(shuttingDown){
			return;
		}
		shuttingDown = true;
		console.log(`Received ${signal}; shutting down`);

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
