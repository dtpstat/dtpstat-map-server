import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildOsmPlacesBatchQuery,
  buildRussianPlaceIdOverpassQueries,
  parseOsmCityResponse,
  parseOsmPlaceIdsResponse,
} from '../src/data/osm-city-parser.js';

const square = [
  { lon: 30, lat: 60 },
  { lon: 31, lat: 60 },
  { lon: 31, lat: 61 },
  { lon: 30, lat: 61 },
  { lon: 30, lat: 60 },
];

test('Overpass index is split into four small Russian type/place queries', () => {
  const parts = buildRussianPlaceIdOverpassQueries(120);

  assert.equal(parts.length, 4);
  assert.deepEqual(parts.map(({ placeType, osmType }) =>
    `${placeType}/${osmType}`), [
    'city/way',
    'city/relation',
    'town/way',
    'town/relation',
  ]);
  for (const part of parts) {
    assert.match(part.query, /ISO3166-1"="RU/);
    assert.match(
      part.query,
      new RegExp(`${part.osmType}\\(area\\.ru\\)\\["place"="${part.placeType}"\\]\\["name"\\]`),
    );
    assert.match(part.query, /out ids/);
    assert.doesNotMatch(part.query, /geom/);
  }
});

test('Overpass geometry query groups one explicit batch by OSM object type', () => {
  const query = buildOsmPlacesBatchQuery([
    { osmType: 'way', osmId: 11 },
    { osmType: 'relation', osmId: 22 },
    { osmType: 'way', osmId: 33 },
  ], 60);

  assert.match(query, /way\(id:11,33\)/);
  assert.match(query, /relation\(id:22\)/);
  assert.match(query, /out body geom/);
});

test('OSM ID parser validates, sorts, and timestamps the complete index', () => {
  const parsed = parseOsmPlaceIdsResponse(JSON.stringify({
    osm3s: { timestamp_osm_base: '2026-08-31T12:00:00Z' },
    elements: [
      { type: 'way', id: 20 },
      { type: 'relation', id: 10 },
      { type: 'way', id: 5 },
    ],
  }));

  assert.deepEqual(parsed.objects, [
    { osmType: 'relation', osmId: 10 },
    { osmType: 'way', osmId: 5 },
    { osmType: 'way', osmId: 20 },
  ]);
  assert.equal(parsed.sourceElements, 3);
  assert.equal(parsed.osmTimestamp, '2026-08-31T12:00:00.000Z');
  assert.throws(
    () => parseOsmPlaceIdsResponse(JSON.stringify({
      elements: [{ type: 'way', id: 5 }, { type: 'way', id: 5 }],
    })),
    /duplicate object way\/5/,
  );
});

test('OSM parser preserves way linework and relation member ways', () => {
  const parsed = parseOsmCityResponse(JSON.stringify({
    osm3s: { timestamp_osm_base: '2026-08-31T12:00:00Z' },
    elements: [
      {
        type: 'way',
        id: 1,
        tags: { name: 'Первый', place: 'city' },
        geometry: square,
      },
      {
        type: 'relation',
        id: 2,
        tags: { name: 'Второй', place: 'town' },
        members: [{ type: 'way', role: 'outer', geometry: square }],
      },
      { type: 'node', id: 3, tags: { name: 'Точка', place: 'city' } },
    ],
  }));

  assert.equal(parsed.places.length, 2);
  assert.equal(parsed.sourceElements, 3);
  assert.equal(parsed.ignoredElements, 1);
  assert.equal(parsed.cityPlaces, 1);
  assert.equal(parsed.townPlaces, 1);
  assert.equal(parsed.duplicateNames, 0);
  assert.equal(parsed.osmTimestamp, '2026-08-31T12:00:00.000Z');
  assert.equal(parsed.places[0].linework.type, 'MultiLineString');
  assert.deepEqual(parsed.places.map((place) => place.name), ['Второй', 'Первый']);
});

test('OSM parser preserves duplicate names as distinct OSM objects', () => {
  const parsed = parseOsmCityResponse(JSON.stringify({
    elements: [
      { type: 'way', id: 1, tags: { name: 'Дубль', place: 'town' }, geometry: square },
      { type: 'way', id: 2, tags: { name: 'Дубль', place: 'town' }, geometry: square },
    ],
  }));

  assert.equal(parsed.places.length, 2);
  assert.equal(parsed.duplicateNames, 1);
  assert.notEqual(parsed.places[0].osmId, parsed.places[1].osmId);
});

test('OSM parser rejects missing way geometry and Overpass remarks', () => {
  assert.throws(
    () => parseOsmCityResponse(JSON.stringify({
      elements: [
        { type: 'relation', id: 1, tags: { name: 'Пустой', place: 'city' }, members: [] },
      ],
    })),
    /has no way geometry/,
  );
  assert.throws(
    () => parseOsmCityResponse(JSON.stringify({
      remark: 'runtime error: Query timed out',
      elements: [],
    })),
    /Overpass returned an error/,
  );
});
