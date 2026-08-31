import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const cities = [
  {
    id: 1,
    slug: 'казань',
    name: 'Казань',
    population: 1257341,
    laneLengthMeters: 182706.97,
    laneMetersPer1000: 145.31,
    category: 'large',
    rank: 1,
    bounds: [48.89, 55.72, 49.23, 55.86],
  },
];

const geojson = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [49.1, 55.7],
          [49.2, 55.8],
        ],
      },
      properties: { lanes: 2 },
    },
  ],
};

const importResult = {
  cities: 71,
  geometries: 872,
  ignoredFeatures: 10,
  updatedAt: '2026-08-31T12:00:00.000Z',
};

const populationResult = {
  cities: 1,
  asOf: '2026-01-01',
  source: 'test',
  updatedAt: '2026-08-31T12:00:00.000Z',
};

function createTestRepository() {
  return {
    async health() {},
    async listCities() {
      return cities;
    },
    async getCityGeometries(cityId) {
      return cityId === 1 ? geojson : null;
    },
  };
}

async function withServer(callback, options = {}) {
  const importService =
    options.importService ??
    ({
      async replaceFromGeoJson() {
        return importResult;
      },
    });
  const populationService =
    options.populationService ??
    ({
      async updateFromJson() {
        return populationResult;
      },
    });
  const app = createApp({
    repository: createTestRepository(),
    importService,
    populationService,
    config: {
      environment: 'test',
      projectRoot,
      importApi: {
        username: 'importer',
        password: 'test:secret',
        maxBodyBytes: options.maxBodyBytes ?? 1024 * 1024,
      },
      publicMap: {
        accessToken: 'pk.test',
        styleUrl: 'mapbox://styles/test/style',
        initialCenter: [49.12, 55.78],
        initialZoom: 12,
      },
    },
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

test('API exposes public config, health, and ordered cities', async () => {
  await withServer(async (baseUrl) => {
    const [configResponse, healthResponse, citiesResponse] = await Promise.all([
      fetch(`${baseUrl}/api/config`),
      fetch(`${baseUrl}/api/health`),
      fetch(`${baseUrl}/api/cities`),
    ]);

    assert.equal(configResponse.status, 200);
    assert.equal((await configResponse.json()).map.accessToken, 'pk.test');
    assert.deepEqual(await healthResponse.json(), {
      status: 'ok',
      database: 'reachable',
    });
    assert.deepEqual((await citiesResponse.json()).cities, cities);
  });
});

test('geometry endpoint validates IDs and returns a FeatureCollection', async () => {
  await withServer(async (baseUrl) => {
    const success = await fetch(`${baseUrl}/api/cities/1/geometries`);
    assert.equal(success.status, 200);
    assert.deepEqual(await success.json(), geojson);

    const invalid = await fetch(`${baseUrl}/api/cities/nope/geometries`);
    assert.equal(invalid.status, 400);

    const missing = await fetch(`${baseUrl}/api/cities/999/geometries`);
    assert.equal(missing.status, 404);
  });
});

test('root serves the optimized client without embedded GeoJSON', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(baseUrl);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /id="city-list"/);
    assert.doesNotMatch(html, /FeatureCollection/);
  });
});

test('import endpoint requires Basic Auth before processing the body', async () => {
  let calls = 0;
  const importService = {
    async replaceFromGeoJson() {
      calls += 1;
      return importResult;
    },
  };

  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/admin/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/geo+json' },
      body: JSON.stringify(geojson),
    });

    assert.equal(response.status, 401);
    assert.match(response.headers.get('www-authenticate'), /^Basic /);
    assert.equal(calls, 0);
  }, { importService });
});

test('authenticated import accepts GeoJSON and returns update statistics', async () => {
  let uploadedBody;
  const importService = {
    async replaceFromGeoJson(body) {
      uploadedBody = body;
      return importResult;
    },
  };
  const authorization = `Basic ${Buffer.from('importer:test:secret').toString('base64')}`;

  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/admin/import`, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/geo+json',
      },
      body: JSON.stringify(geojson),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok', ...importResult });
    assert.deepEqual(uploadedBody, geojson);
  }, { importService });
});

test('import endpoint rejects unsupported and malformed bodies', async () => {
  const authorization = `Basic ${Buffer.from('importer:test:secret').toString('base64')}`;

  await withServer(async (baseUrl) => {
    const unsupported = await fetch(`${baseUrl}/api/admin/import`, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'text/plain',
      },
      body: '{}',
    });
    assert.equal(unsupported.status, 415);

    const malformed = await fetch(`${baseUrl}/api/admin/import`, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
      },
      body: '{',
    });
    assert.equal(malformed.status, 400);
  });
});

test('import endpoint enforces the configured upload limit', async () => {
  const authorization = `Basic ${Buffer.from('importer:test:secret').toString('base64')}`;

  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/admin/import`, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/geo+json',
      },
      body: JSON.stringify(geojson),
    });

    assert.equal(response.status, 413);
  }, { maxBodyBytes: 64 });
});

test('authenticated population endpoint updates a separate data source', async () => {
  let uploadedBody;
  const populationService = {
    async updateFromJson(body) {
      uploadedBody = body;
      return populationResult;
    },
  };
  const authorization = `Basic ${Buffer.from('importer:test:secret').toString('base64')}`;
  const body = {
    asOf: '2026-01-01',
    source: 'test',
    populations: [{ name: 'Казань', population: 1300000 }],
  };

  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/admin/populations`, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: 'ok',
      ...populationResult,
    });
    assert.deepEqual(uploadedBody, body);
  }, { populationService });
});
