import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CITY_MARKER_ICON_MAX_BYTES,
  CityMarkerIconValidationError,
  validateCityMarkerIcon,
} from '../src/data/city-marker-icon.js';
import {
  CITY_MARKER_ICON,
  CITY_MARKER_ICON_URL,
} from '../public/js/city-marker-icon.js';
import { citiesToMarkerGeoJson } from '../public/js/map-controller.js';

const bundledPng = Buffer.from(CITY_MARKER_ICON.split(',')[1], 'base64');

test('bundled marker is a valid upload and configurable URL is public', () => {
  const icon = validateCityMarkerIcon(bundledPng, 'image/png');
  assert.equal(CITY_MARKER_ICON_URL, '/api/city-marker-icon');
  assert.equal(icon.mime, 'image/png');
  assert.equal(icon.width, 32);
  assert.equal(icon.height, 32);
  assert.equal(icon.data, bundledPng);
});

test('city marker upload rejects unsupported content and oversized payloads', () => {
  assert.throws(
    () => validateCityMarkerIcon(bundledPng, 'image/jpeg'),
    CityMarkerIconValidationError,
  );
  assert.throws(
    () => validateCityMarkerIcon(Buffer.alloc(CITY_MARKER_ICON_MAX_BYTES + 1), 'image/png'),
    CityMarkerIconValidationError,
  );
});

test('city without a calculated rank still gets a low-zoom marker', () => {
  const markers = citiesToMarkerGeoJson([
    {
      id: 17,
      name: 'Город без населения',
      category: 'small',
      rank: null,
      center: [49.1, 55.8],
    },
  ]);

  assert.equal(markers.features.length, 1);
  assert.deepEqual(markers.features[0], {
    type: 'Feature',
    id: 17,
    geometry: { type: 'Point', coordinates: [49.1, 55.8] },
    properties: {
      cityId: 17,
      name: 'Город без населения',
      priority: 1999,
    },
  });
});
