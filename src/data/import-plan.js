import { parse } from 'csv-parse/sync';
import { buildGeoJsonPlan } from './geojson-plan.js';
import { buildPopulationPlan } from './population-plan.js';

/**
 * Validate the repository's two independent source snapshots. Geometry owns
 * city names and shapes; the CSV supplies population only. Length and rating
 * are deliberately not trusted here because PostGIS calculates both.
 *
 * @param {string} csvText
 * @param {string} geojsonText
 */
export function buildImportPlan(csvText, geojsonText) {
  const rows = parse(csvText, {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    trim: true,
  });
  const geoJsonPlan = buildGeoJsonPlan(JSON.parse(geojsonText));
  const populationPayload = buildPopulationPlan({
    source: 'bus-lanes.csv',
    populations: rows.map((row) => ({
      name: row.short_name,
      population: row.population,
    })),
  });

  const geometryNames = new Set(geoJsonPlan.cities.map((city) => city.name));
  const populationNames = new Set(
    populationPayload.populations.map((item) => item.name),
  );
  for (const name of geometryNames) {
    if (!populationNames.has(name)) {
      throw new Error(`No population found for city ${name}`);
    }
  }
  for (const name of populationNames) {
    if (!geometryNames.has(name)) {
      throw new Error(`Population references unknown city ${name}`);
    }
  }

  return {
    ...geoJsonPlan,
    populationPayload,
  };
}
