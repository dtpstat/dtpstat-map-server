import assert from 'node:assert/strict';
import test from 'node:test';
import {
  downloadOsmCities,
  OsmCityDownloadError,
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
