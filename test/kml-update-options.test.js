import assert from 'node:assert/strict';
import test from 'node:test';
import {
  KmlUpdateValidationError,
  parseKmlSourcesJson,
  resolveKmlUpdateRequest,
  validateKmlSources,
} from '../src/data/kml-update-options.js';

const constraints = {
  maxSources: 3,
  allowedHosts: new Set(['www.google.com']),
};

const rawSources = [
  {
    URL: 'https://www.google.com/maps/d/viewer?mid=map_1',
    layers: [
      { name: 'Односторонние', multiple: 1 },
      { name: 'Двусторонние', multiple: 2 },
    ],
  },
];

test('KML source contract keeps explicit layer multipliers and normalizes My Maps URLs', () => {
  const [source] = validateKmlSources(rawSources, constraints);

  assert.equal(source.mapId, 'map_1');
  assert.equal(
    source.fetchURL,
    'https://www.google.com/maps/d/kml?mid=map_1&forcekml=1',
  );
  assert.deepEqual(source.layers, rawSources[0].layers);
});

test('KML source contract rejects misspelled or unsafe input', () => {
  assert.throws(
    () =>
      validateKmlSources([
        {
          URL: 'https://www.google.com/maps/d/viewer?mid=map_1',
          layers: [{ name: 'Слой', multilpe: 2 }],
        },
      ], constraints),
    /unsupported properties: multilpe/,
  );
  assert.throws(
    () =>
      validateKmlSources([
        {
          URL: 'http://www.google.com/maps/d/viewer?mid=map_1',
          layers: [{ name: 'Слой', multiple: 2 }],
        },
      ], constraints),
    /must use HTTPS/,
  );
  assert.throws(
    () =>
      validateKmlSources([
        {
          URL: 'https://internal.example/map.kml',
          layers: [{ name: 'Слой', multiple: 2 }],
        },
      ], constraints),
    /host is not allowed/,
  );
});

test('request sources replace ENV sources and query overrides cannot raise limits', () => {
  const environmentSources = parseKmlSourcesJson(
    JSON.stringify(rawSources),
    constraints,
  );
  const config = {
    ...constraints,
    sources: environmentSources,
    dryRun: false,
    timeoutMs: 30000,
    maxFileBytes: 1000000,
    maxTotalBytes: 2000000,
    cityBufferMeters: 0,
    cityBufferMaxMeters: 5000,
    unmatchedPolicy: 'skip',
    ambiguousPolicy: 'best-overlap',
  };

  const resolved = resolveKmlUpdateRequest(rawSources, {
    dryRun: 'true',
    timeoutMs: '5000',
    cityBufferMeters: '250',
    ambiguousPolicy: 'fail',
  }, config);
  assert.equal(resolved.dryRun, true);
  assert.equal(resolved.timeoutMs, 5000);
  assert.equal(resolved.cityBufferMeters, 250);
  assert.equal(resolved.ambiguousPolicy, 'fail');
  assert.equal(resolved.sources[0].mapId, 'map_1');

  assert.throws(
    () => resolveKmlUpdateRequest(undefined, { timeoutMs: '30001' }, config),
    KmlUpdateValidationError,
  );
  assert.throws(
    () => resolveKmlUpdateRequest(undefined, { cityBufferMeters: '5001' }, config),
    KmlUpdateValidationError,
  );
});
