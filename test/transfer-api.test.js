import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createApp } from '../src/app.js';

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const authorization = `Basic ${Buffer.from('importer:test:secret').toString('base64')}`;

const citySnapshot = {
  type: 'FeatureCollection',
  schemaVersion: 1,
  exportedAt: '2026-09-05T12:00:00.000Z',
  padding: 'x'.repeat(4096),
  features: [],
};
const lineSnapshot = {
  type: 'FeatureCollection',
  schemaVersion: 1,
  features: [],
};
const populationSnapshot = {
  schemaVersion: 1,
  populations: [],
};

function config() {
  return {
    environment: 'test',
    projectRoot,
    importApi: {
      username: 'importer',
      password: 'test:secret',
      maxBodyBytes: 1024 * 1024,
    },
    kmlUpdate: {
      maxRequestBodyBytes: 256 * 1024,
      allowedHosts: new Set(['www.google.com']),
      maxSources: 10,
      sources: [],
      timeoutMs: 30000,
      maxFileBytes: 1000000,
      maxTotalBytes: 5000000,
      cityBufferMeters: 0,
      cityBufferMaxMeters: 5000,
      dryRun: false,
      unmatchedPolicy: 'skip',
      ambiguousPolicy: 'best-overlap',
    },
    osmCityUpdate: {
      maxRequestBodyBytes: 16 * 1024,
      url: 'https://overpass-api.de/api/interpreter',
      allowedHosts: new Set(['overpass-api.de']),
      allowedURLs: new Set(['https://overpass-api.de/api/interpreter']),
      dryRun: false,
      timeoutMs: 180000,
      queryTimeoutSeconds: 120,
      maxBytes: 1000000,
      batchSize: 50,
      maxBatchSize: 200,
      minDelayMs: 5000,
      maxRetries: 6,
      retryBaseDelayMs: 30000,
      retryMaxDelayMs: 240000,
      userAgent: 'dtpstat-buslines/2.0 test',
    },
    publicMap: {
      accessToken: 'pk.test',
      styleUrl: 'mapbox://styles/test/style',
      initialCenter: [49.12, 55.78],
      initialZoom: 12,
    },
  };
}

function repository() {
  return {
    async health() {},
    async listCities() { return []; },
    async getCityGeometries() { return null; },
    async getViewportGeometries() {
      return { type: 'FeatureCollection', features: [] };
    },
  };
}

async function withServer(callback, overrides = {}) {
  const app = createApp({
    repository: repository(),
    exportRepository: overrides.exportRepository ?? {
      async exportCityBoundaries() { return citySnapshot; },
      async exportLines() { return lineSnapshot; },
      async exportPopulations() { return populationSnapshot; },
    },
    importService: overrides.importService ?? {
      async replaceFromGeoJson() { return { geometries: 0 }; },
    },
    cityBoundaryTransferService: overrides.cityBoundaryTransferService ?? {
      async replaceFromGeoJson() { return { importedPlaces: 0 }; },
    },
    populationService: overrides.populationService ?? {
      async updateFromJson() { return { cities: 0 }; },
    },
    kmlUpdateService: { async update() { return {}; } },
    osmCityUpdateService: { async update() { return {}; } },
    config: config(),
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

async function waitForTask(baseUrl, accepted) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await fetch(`${baseUrl}${accepted.task.statusURL}`, {
      headers: { Authorization: authorization },
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    if (['succeeded', 'failed', 'cancelled'].includes(payload.status)) {
      return payload;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('transfer task did not finish');
}

test('transfer exports require auth and expose portable download files', async () => {
  await withServer(async (baseUrl) => {
    const unauthorized = await fetch(`${baseUrl}/api/admin/export/cities`);
    assert.equal(unauthorized.status, 401);

    const expectations = [
      ['/api/admin/export/cities', 'dtpstat-buslines-cities.geojson', citySnapshot],
      ['/api/admin/export/lines', 'dtpstat-buslines-lines.geojson', lineSnapshot],
      ['/api/admin/export/populations', 'dtpstat-buslines-populations.json', populationSnapshot],
    ];
    for (const [endpoint, fileName, expected] of expectations) {
      const response = await fetch(`${baseUrl}${endpoint}`, {
        headers: {
          Authorization: authorization,
          'Accept-Encoding': 'gzip',
        },
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.match(
        response.headers.get('content-disposition') ?? '',
        new RegExp(fileName.replace('.', '\\.')),
      );
      assert.deepEqual(await response.json(), expected);
    }
  });
});

test('large transfer export is gzip-compressed when the receiver accepts gzip', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/admin/export/cities`, {
      headers: {
        Authorization: authorization,
        'Accept-Encoding': 'gzip',
      },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-encoding'), 'gzip');
    assert.deepEqual(await response.json(), citySnapshot);
  });
});

test('city GeoJSON import accepts a gzip request body and forwards dryRun', async () => {
  let receivedBody;
  let receivedOperation;
  const result = {
    dryRun: true,
    importedPlaces: 1,
    linkedCities: 0,
    restoredGeometryLinks: 0,
  };
  const transferService = {
    async replaceFromGeoJson(body, operation) {
      receivedBody = body;
      receivedOperation = operation;
      return result;
    },
  };
  const body = {
    type: 'FeatureCollection',
    schemaVersion: 1,
    features: [{ type: 'Feature', properties: {}, geometry: null }],
  };

  await withServer(async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/admin/import/cities?dryRun=true`,
      {
        method: 'POST',
        headers: {
          Authorization: authorization,
          'Content-Type': 'application/geo+json',
          'Content-Encoding': 'gzip',
        },
        body: gzipSync(Buffer.from(JSON.stringify(body))),
      },
    );
    assert.equal(response.status, 202);
    const accepted = await response.json();
    const completed = await waitForTask(baseUrl, accepted);
    assert.equal(completed.status, 'succeeded');
    assert.equal(completed.task.type, 'city-geojson-import');
    assert.deepEqual(completed.task.result, result);
    assert.deepEqual(receivedBody, body);
    assert.equal(receivedOperation.dryRun, true);
  }, { cityBoundaryTransferService: transferService });
});

test('line and population imports accept gzip request bodies', async () => {
  let receivedLines;
  let receivedPopulations;
  const lines = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { short_name: 'Казань', lanes: 1 },
      geometry: { type: 'LineString', coordinates: [[49, 55], [49.1, 55.1]] },
    }],
  };
  const populations = {
    populations: [{ name: 'Казань', population: 1300000 }],
  };

  await withServer(async (baseUrl) => {
    const lineResponse = await fetch(`${baseUrl}/api/admin/import/lines`, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/geo+json',
        'Content-Encoding': 'gzip',
      },
      body: gzipSync(Buffer.from(JSON.stringify(lines))),
    });
    const lineAccepted = await lineResponse.json();
    assert.equal((await waitForTask(baseUrl, lineAccepted)).status, 'succeeded');
    assert.deepEqual(receivedLines, lines);

    const populationResponse = await fetch(`${baseUrl}/api/admin/populations`, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
        'Content-Encoding': 'gzip',
      },
      body: gzipSync(Buffer.from(JSON.stringify(populations))),
    });
    const populationAccepted = await populationResponse.json();
    assert.equal((await waitForTask(baseUrl, populationAccepted)).status, 'succeeded');
    assert.deepEqual(receivedPopulations, populations);
  }, {
    importService: {
      async replaceFromGeoJson(body) {
        receivedLines = body;
        return { geometries: 1 };
      },
    },
    populationService: {
      async updateFromJson(body) {
        receivedPopulations = body;
        return { cities: 1 };
      },
    },
  });
});
