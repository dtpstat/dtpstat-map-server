import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_PUBLIC_DOWNLOAD_NAME,
  normalizePublicDownloadName,
} from '../src/data/public-download-name.js';
import { ProjectSettingsValidationError } from '../src/data/project-settings.js';

test('public download name defaults and normalizes a base file name without extension', () => {
  assert.equal(normalizePublicDownloadName(undefined), DEFAULT_PUBLIC_DOWNLOAD_NAME);
  assert.equal(normalizePublicDownloadName('  Трамвайные   линии  '), 'Трамвайные линии');
  assert.equal(normalizePublicDownloadName('tram-lines_2026'), 'tram-lines_2026');
  assert.equal(normalizePublicDownloadName(undefined, { optional: true }), null);
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
