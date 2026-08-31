import express, {Router}        from 'express';
import {GeoJsonValidationError} from '../data/geojson-plan.js';
import {PopulationValidationError} from '../data/population-plan.js';
import {createBasicAuth}        from '../http/basic-auth.js';

/**
 * @typedef {{
 *   health: () => Promise<void>,
 *   listCities: () => Promise<any[]>,
 *   getCityGeometries: (cityId: number) => Promise<object | null>
 * }} CitiesRepository
 */

/**
 * @typedef {{
 *   replaceFromGeoJson: (collection: unknown) => Promise<{
 *     cities: number,
 *     geometries: number,
 *     ignoredFeatures: number,
 *     updatedAt: string
 *   }>
 * }} DataImportService
 */

/**
 * @typedef {{
 *   updateFromJson: (payload: unknown) => Promise<{
 *     cities: number,
 *     asOf: string | null,
 *     source: string | null,
 *     updatedAt: string
 *   }>
 * }} PopulationImportService
 */

/**
 * @param {{
 *   repository: CitiesRepository,
 *   importService: DataImportService,
 *   populationService: PopulationImportService,
 *   publicMap: object,
 *   importApi: { username: string, password: string, maxBodyBytes: number }
 * }} dependencies
 */
export function createApiRouter({
	                                repository,
	                                importService,
	                                populationService,
	                                publicMap,
	                                importApi,
                                }){
	const router            = Router();
	const requireImportAuth = createBasicAuth({
		username: importApi.username,
		password: importApi.password,
	});

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

	router.post(
		'/admin/import',
		requireImportAuth,
		express.json({
			limit:  importApi.maxBodyBytes,
			strict: true,
			type:   ['application/json', 'application/geo+json'],
		}),
		async(request, response, next) => {
			if(request.body === undefined){
				response.status(415).json({
					error: 'Content-Type must be application/json or application/geo+json',
				});
				return;
			}

			try{
				const result = await importService.replaceFromGeoJson(request.body);
				response.set('Cache-Control', 'no-store');
				response.json({status: 'ok', ...result});
			}catch(error){
				if(error instanceof GeoJsonValidationError){
					response.status(400).json({error: error.message});
					return;
				}
				next(error);
			}
		},
	);

	router.post(
		'/admin/populations',
		requireImportAuth,
		express.json({
			limit:  importApi.maxBodyBytes,
			strict: true,
			type:   'application/json',
		}),
		async(request, response, next) => {
			if(request.body === undefined){
				response.status(415).json({
					error: 'Content-Type must be application/json',
				});
				return;
			}

			try{
				const result = await populationService.updateFromJson(request.body);
				response.set('Cache-Control', 'no-store');
				response.json({status: 'ok', ...result});
			}catch(error){
				if(error instanceof PopulationValidationError){
					response.status(400).json({error: error.message});
					return;
				}
				next(error);
			}
		},
	);

	return router;
}
