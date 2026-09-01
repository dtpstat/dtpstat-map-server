import assert from 'node:assert/strict';
import test from 'node:test';
import {
  downloadOsmCities,
  OsmCityDownloadError,
  parseRetryAfterMs,
} from '../src/data/osm-city-downloader.js';

const options = {
  timeoutMs: 1000,
  maxBytes: 1024,
  allowedHosts: new Set(['overpass-api.de']),
};

test('OSM downloader posts the Overpass query and counts response bytes', async () => {
  let request;
  const jsonText = JSON.stringify({ elements: [] });
  const result = await downloadOsmCities(
    'https://overpass-api.de/api/interpreter',
    '[out:json];out;',
    options,
    async (url, init) => {
      request = { url: url.toString(), init };
      return new Response(jsonText, { status: 200 });
    },
  );

  assert.equal(request.url, 'https://overpass-api.de/api/interpreter');
  assert.equal(request.init.method, 'POST');
  assert.match(request.init.body, /^data=/);
  assert.equal(result.jsonText, jsonText);
  assert.equal(result.bytes, Buffer.byteLength(jsonText));
});

test('OSM downloader rejects foreign redirects and oversized responses', async () => {
  await assert.rejects(
    downloadOsmCities(
      'https://overpass-api.de/api/interpreter',
      'out;',
      options,
      async () => new Response(null, {
        status: 302,
        headers: { Location: 'https://internal.example/query' },
      }),
    ),
    OsmCityDownloadError,
  );
  await assert.rejects(
    downloadOsmCities(
      'https://overpass-api.de/api/interpreter',
      'out;',
      { ...options, maxBytes: 4 },
      async () => new Response('{"elements":[]}', { status: 200 }),
    ),
    /size limit/,
  );
});

test('OSM downloader preserves HTTP 429 and Retry-After metadata', async () => {
  await assert.rejects(
    downloadOsmCities(
      'https://overpass-api.de/api/interpreter',
      'out;',
      options,
      async () => new Response(null, {
        status: 429,
        headers: { 'Retry-After': '45' },
      }),
    ),
    (error) => {
      assert.ok(error instanceof OsmCityDownloadError);
      assert.equal(error.statusCode, 429);
      assert.equal(error.retryAfterMs, 45000);
      assert.equal(error.finalURL, 'https://overpass-api.de/api/interpreter');
      return true;
    },
  );
});

test('Retry-After supports seconds and HTTP dates', () => {
  const now = Date.parse('2026-09-01T12:00:00.000Z');
  assert.equal(parseRetryAfterMs('30', now), 30000);
  assert.equal(
    parseRetryAfterMs('Tue, 01 Sep 2026 12:02:00 GMT', now),
    120000,
  );
  assert.equal(parseRetryAfterMs('invalid', now), null);
});
