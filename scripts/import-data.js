import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildImportPlan } from '../src/data/import-plan.js';
import { createPublicDownloadService } from '../src/data/public-download-service.js';
import { createDataImportService } from '../src/db/data-import-service.js';
import { loadDatabaseSchema } from '../src/db/database-environment.js';
import { createPopulationImportService } from '../src/db/population-import-service.js';
import { createPublicDownloadRepository } from '../src/db/public-download-repository.js';
import { createDatabaseClient } from './database.js';

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

async function main() {
  const [csvText, geojsonText] = await Promise.all([
    fs.readFile(path.join(projectRoot, 'bus-lanes.csv'), 'utf8'),
    fs.readFile(path.join(projectRoot, 'bus-lanes.geojson'), 'utf8'),
  ]);
  const plan = buildImportPlan(csvText, geojsonText);
  const geojson = JSON.parse(geojsonText);
  const client = createDatabaseClient();
  const databaseSchema = loadDatabaseSchema();

  await client.connect();
  const poolAdapter = {
    databaseSchema,
    async connect() {
      return {
        query: (...args) => client.query(...args),
        release() {},
      };
    },
  };

  try {
    const geometryResult = await createDataImportService(
      poolAdapter,
    ).replaceFromGeoJson(geojson);
    const populationResult = await createPopulationImportService(
      poolAdapter,
    ).updateFromJson(plan.populationPayload);
    const publicDownloads = await createPublicDownloadService({
      repository: createPublicDownloadRepository(client),
      directory: path.join(projectRoot, 'var', 'public-downloads'),
    }).refresh();

    console.log(
      `Imported ${geometryResult.cities} cities, ` +
        `${geometryResult.geometries} geometries and ` +
        `${populationResult.cities} population records; ` +
        `ignored ${geometryResult.ignoredFeatures} unnamed source artifacts; ` +
        `materialized ${publicDownloads.featureCount} public GeoJSON features ` +
        `and ${publicDownloads.cityCount} CSV rows.`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('Data import failed', error);
  process.exitCode = 1;
});
