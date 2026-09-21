import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFile(path.join(root, relative), 'utf8');

test('geometry editor API separates cities, city geometry summaries and geometry details', async () => {
  const route = await read('src/routes/geometry-editor-api.js');

  assert.match(route, /\/admin\/geometry-editor\/cities'/);
  assert.match(route, /\/admin\/geometry-editor\/cities\/:cityId\/geometries/);
  assert.match(route, /\/admin\/geometry-editor\/geometries\/:geometryId/);
  assert.doesNotMatch(
    route,
    /listCities\(\)[\s\S]{0,300}lineTypesRepository\.list/,
  );
  assert.doesNotMatch(
    route,
    /listCities\(\)[\s\S]{0,300}listTags\(/,
  );
});

test('city geometry summaries omit expensive detail-only attributes', async () => {
  const repository = await read('src/db/geometry-editor-repository.js');
  const start = repository.indexOf('const GEOMETRY_SUMMARIES_SQL');
  const end = repository.indexOf('const ONE_GEOMETRY_SQL');
  const summarySql = repository.slice(start, end);

  assert.match(summarySql, /display_name AS "displayName"/);
  assert.match(summarySql, /ST_AsGeoJSON\(geometry\.geom\)::json AS geometry/);
  assert.doesNotMatch(summarySql, /source_tags/);
  assert.doesNotMatch(summarySql, /tooltip/);
  assert.doesNotMatch(summarySql, /perimeterMeters/);
  assert.doesNotMatch(summarySql, /areaSquareMeters/);
  assert.doesNotMatch(summarySql, /createdAt/);
});

test('city catalog does not fetch map bounds or geometry detail fields', async () => {
  const repository = await read('src/db/geometry-editor-repository.js');
  const start = repository.indexOf('const CITIES_SQL');
  const end = repository.indexOf('const CITY_SQL');
  const citySql = repository.slice(start, end);

  assert.match(citySql, /geometryCount/);
  assert.doesNotMatch(citySql, /ST_XMin|ST_PointOnSurface|ST_AsGeoJSON/);
});
