import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildImportPlan } from '../src/data/import-plan.js';
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
  const client = createDatabaseClient();

  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('TRUNCATE city_geometries, cities RESTART IDENTITY CASCADE');

    const cityIds = new Map();
    for (const city of plan.cities) {
      const result = await client.query(
        `
          INSERT INTO cities (
            source_index, slug, name, full_name, population, lane_length_m,
            bounds, attributes
          ) VALUES (
            $1, $2, $3, $4, $5, $6,
            ST_MakeBox2D(ST_Point($7, $8), ST_Point($9, $10)), $11
          )
          RETURNING id
        `,
        [
          city.sourceIndex,
          city.slug,
          city.name,
          city.fullName,
          city.population,
          city.laneLengthMeters,
          ...city.bounds,
          city.attributes,
        ],
      );
      cityIds.set(city.name, result.rows[0].id);
    }

    for (const geometry of plan.geometries) {
      await client.query(
        `
          INSERT INTO city_geometries (
            city_id, lanes, length_m, lane_length_m, properties, geom
          ) VALUES (
            $1, $2, $3, $4, $5,
            ST_SetSRID(ST_GeomFromGeoJSON($6), 4326)
          )
        `,
        [
          cityIds.get(geometry.cityName),
          geometry.lanes,
          geometry.lengthMeters,
          geometry.laneLengthMeters,
          geometry.properties,
          JSON.stringify(geometry.geometry),
        ],
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }

  console.log(
    `Imported ${plan.cities.length} cities and ${plan.geometries.length} geometries; ` +
      `ignored ${plan.ignoredFeatures.length} unnamed source artifacts.`,
  );
}

main().catch((error) => {
  console.error('Data import failed', error);
  process.exitCode = 1;
});
