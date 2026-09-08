import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_PUBLIC_DOWNLOAD_NAME,
  normalizePublicDownloadName,
  publicDownloadFiles,
} from '../src/data/public-download-name.js';
import { ProjectSettingsValidationError } from '../src/data/project-settings.js';

test('public download name defaults and normalizes a base file name without extension', () => {
  assert.equal(normalizePublicDownloadName(undefined), DEFAULT_PUBLIC_DOWNLOAD_NAME);
  assert.equal(normalizePublicDownloadName('  Трамвайные   линии  '), 'Трамвайные линии');
  assert.equal(normalizePublicDownloadName('tram-lines_2026'), 'tram-lines_2026');
  assert.equal(normalizePublicDownloadName(undefined, { optional: true }), null);
});

test('public download file names and URLs are derived from one configured base name', () => {
  assert.deepEqual(publicDownloadFiles('Трамвайные линии'), {
    baseName: 'Трамвайные линии',
    geoJsonFileName: 'Трамвайные линии.geojson',
    csvFileName: 'Трамвайные линии.csv',
    geoJsonUrl: '/%D0%A2%D1%80%D0%B0%D0%BC%D0%B2%D0%B0%D0%B9%D0%BD%D1%8B%D0%B5%20%D0%BB%D0%B8%D0%BD%D0%B8%D0%B8.geojson',
    csvUrl: '/%D0%A2%D1%80%D0%B0%D0%BC%D0%B2%D0%B0%D0%B9%D0%BD%D1%8B%D0%B5%20%D0%BB%D0%B8%D0%BD%D0%B8%D0%B8.csv',
  });
});

test('public download name rejects extensions, path syntax and unsafe values', () => {
  for (const value of [
    '',
    '   ',
    '.',
    '..',
    'tram/lines',
    'tram\\lines',
    'tram-lines.csv',
    'tram-lines.GEOJSON',
    'bad\nname',
    'x'.repeat(121),
  ]) {
    assert.throws(
      () => normalizePublicDownloadName(value),
      ProjectSettingsValidationError,
    );
  }
});
