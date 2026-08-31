import { parse } from 'csv-parse/sync';
import { buildGeoJsonPlan, slugify } from './geojson-plan.js';

const NUMBER_FIELDS = [
  'lanes_length',
  'population',
  'minx',
  'miny',
  'maxx',
  'maxy',
];

/** @param {unknown} value */
function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * Convert the repository's CSV and GeoJSON snapshots into validated database
 * records. The CSV remains an additional consistency check for the CLI import,
 * while the HTTP importer derives statistics directly from GeoJSON.
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
  const geoJsonCities = new Map(
    geoJsonPlan.cities.map((city) => [city.name, city]),
  );
  const names = new Set();
  const slugs = new Set();

  const cities = rows.map((row, rowIndex) => {
    const name = row.short_name?.trim();
    if (!name) throw new Error(`CSV row ${rowIndex + 2} has no short_name`);
    if (names.has(name)) throw new Error(`Duplicate city in CSV: ${name}`);
    names.add(name);

    for (const field of NUMBER_FIELDS) {
      if (finiteNumber(row[field]) === null) {
        throw new Error(`Invalid ${field} for city ${name}`);
      }
    }

    const slug = slugify(name);
    if (!slug || slugs.has(slug)) {
      throw new Error(`Invalid or duplicate city slug for ${name}`);
    }
    slugs.add(slug);

    const geoJsonCity = geoJsonCities.get(name);
    if (!geoJsonCity) {
      throw new Error(`No named GeoJSON geometries found for ${name}`);
    }

    const laneLengthMeters = Number(row.lanes_length);
    if (Math.abs(geoJsonCity.laneLengthMeters - laneLengthMeters) > 0.001) {
      throw new Error(
        `Lane length mismatch for ${name}: CSV=${laneLengthMeters}, GeoJSON=${geoJsonCity.laneLengthMeters}`,
      );
    }

    const population = Number(row.population);
    const calculatedRating = (laneLengthMeters / population) * 1000;
    if (Math.abs(calculatedRating - Number(row.lanes_per_1K)) > 0.000001) {
      throw new Error(`Rating mismatch for ${name}`);
    }

    return {
      sourceIndex: finiteNumber(row['']),
      slug,
      name,
      fullName: geoJsonCity.fullName,
      population,
      laneLengthMeters,
      sourceLaneMetersPer1000: Number(row.lanes_per_1K),
      bounds: [
        Number(row.minx),
        Number(row.miny),
        Number(row.maxx),
        Number(row.maxy),
      ],
      attributes: geoJsonCity.attributes,
    };
  });

  for (const city of geoJsonPlan.cities) {
    if (!names.has(city.name)) {
      throw new Error(`GeoJSON references unknown city ${city.name}`);
    }
  }

  return {
    cities,
    geometries: geoJsonPlan.geometries,
    ignoredFeatures: geoJsonPlan.ignoredFeatures,
  };
}
