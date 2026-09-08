import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { createAdminTaskManager } from '../src/data/admin-task-manager.js';

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

const kmlUpdateResult = {
  dryRun: true,
  importedGeometries: 918,
  skippedWithoutCity: 23,
  resolvedAmbiguous: 27,
  completedAt: '2026-08-31T12:00:00.000Z',
};

const osmCityUpdateResult = {
  dryRun: true,
  sourceElements: 194,
  importedPlaces: 194,
  completedAt: '2026-08-31T12:00:00.000Z',
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
    async getViewportGeometries(viewport) {
      return {
        ...geojson,
        bbox: [viewport.west, viewport.south, viewport.east, viewport.north],
        centerCityId: 1,
      };
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
  const kmlUpdateService =
    options.kmlUpdateService ??
    ({
      async update() {
        return kmlUpdateResult;
      },
    });
  const osmCityUpdateService =
    options.osmCityUpdateService ??
    ({
      async update() {
        return osmCityUpdateResult;
      },
    });
  const app = createApp({
    adminTasks: options.adminTasks,
    repository: options.repository ?? createTestRepository(),
    projectSettingsRepository: options.projectSettingsRepository,
    importService,
    populationService,
    kmlUpdateService,
    osmCityUpdateService,
    config: {
      environment: 'test',
      projectRoot,
      importApi: {
        username: 'importer',
        password: 'test:secret',
        maxBodyBytes: options.maxBodyBytes ?? 1024 * 1024,
      },
      kmlUpdate: {
        maxRequestBodyBytes: options.kmlMaxBodyBytes ?? 256 * 1024,
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
        maxRequestBodyBytes: options.osmMaxBodyBytes ?? 16 * 1024,
        url: 'https://overpass-api.de/api/interpreter',
        allowedHosts: new Set(['overpass-api.de']),
        allowedURLs: new Set([
          'https://overpass-api.de/api/interpreter',
        ]),
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

async function waitForAdminTask(baseUrl, accepted, authorization) {
  let statusBody;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const statusResponse = await fetch(
      `${baseUrl}${accepted.task.statusURL}`,
      { headers: { Authorization: authorization } },
    );
    assert.equal(statusResponse.status, 200);
    statusBody = await statusResponse.json();
    if (
      statusBody.status === 'succeeded' ||
      statusBody.status === 'failed' ||
      statusBody.status === 'cancelled'
    ) {
      return statusBody;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('Admin task did not finish in time');
}

async function acceptAndWaitForAdminTask(response, baseUrl, authorization) {
  assert.equal(response.status, 202);
  const accepted = await response.json();
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.task.status, 'queued');
  assert.equal(accepted.taskId, accepted.task.id);
  assert.match(accepted.taskId, /^[0-9a-f-]{36}$/);
  assert.equal(response.headers.get('location'), accepted.task.statusURL);
  return {
    accepted,
    completed: await waitForAdminTask(baseUrl, accepted, authorization),
  };
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

test('public page emits analytics markup and a CSP that permits configured collectors', async () => {
  const projectSettingsRepository = {
    async get() {
      return {
        projectName: 'Analytics test',
        keywords: ['analytics'],
        footerHtml: '<p>Analytics</p>',
        yandexMetrikaId: '12345678',
        googleAnalyticsId: 'G-AB12CD34EF',
        themePreset: 'classic',
        showLineLabels: false,
        showLinePopups: true,
        publicDownloadName: 'analytics-test',
        updatedAt: '2026-09-08T00:00:00.000Z',
      };
    },
    async save(payload) { return payload; },
  };

  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/`);
    assert.equal(response.status, 200);
    const html = await response.text();
    const csp = response.headers.get('content-security-policy') ?? '';

    assert.match(html, /name="yandex-metrika-id" content="12345678"/);
    assert.match(html, /name="google-analytics-id" content="G-AB12CD34EF"/);
    assert.match(html, /<script src="\/js\/metrics\.js"><\/script>/);
    assert.ok(html.indexOf('/js/metrics.js') < html.indexOf('</head>'));
    assert.ok(html.indexOf('/js/metrics.js') < html.indexOf('/js/app.js'));

    assert.match(csp, /script-src[^;]*https:\/\/mc\.yandex\.ru/);
    assert.match(csp, /script-src[^;]*https:\/\/mc\.yandex\.com/);
    assert.match(csp, /script-src[^;]*https:\/\/mc\.webvisor\.org/);
    assert.match(csp, /script-src[^;]*https:\/\/yastatic\.net/);
    assert.match(csp, /img-src[^;]*https:\/\/yandex\.ru(?:\s|;)/);
    assert.doesNotMatch(csp, /script-src[^;]*\shttps:\/\/yandex\.ru(?:\s|;)/);
    assert.doesNotMatch(csp, /connect-src[^;]*\shttps:\/\/yandex\.ru(?:\s|;)/);
    assert.match(csp, /script-src[^;]*https:\/\/\*\.googletagmanager\.com/);
    assert.match(csp, /connect-src[^;]*wss:\/\/mc\.webvisor\.org/);
    assert.match(csp, /connect-src[^;]*https:\/\/\*\.google-analytics\.com/);
    assert.match(csp, /connect-src[^;]*https:\/\/\*\.analytics\.google\.com/);
    assert.match(csp, /frame-src[^;]*https:\/\/mc\.webvisor\.com/);
    assert.match(csp, /frame-ancestors[^;]*metrika\.yandex\.ru/);
    assert.match(csp, /frame-ancestors[^;]*analytics\.yandex\.com/);
  }, { projectSettingsRepository });
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

test('viewport geometry endpoint validates bounds and forwards the map center', async () => {
  let receivedViewport;
  const repository = {
    ...createTestRepository(),
    async getViewportGeometries(viewport) {
      receivedViewport = viewport;
      return {
        type: 'FeatureCollection',
        bbox: [37.4, 55.6, 37.9, 55.9],
        centerCityId: 1,
        features: [],
      };
    },
  };

  await withServer(async (baseUrl) => {
    const success = await fetch(
      `${baseUrl}/api/geometries?bbox=37.4,55.6,37.9,55.9&center=37.62,55.75`,
    );
    assert.equal(success.status, 200);
    assert.equal(success.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await success.json(), {
      type: 'FeatureCollection',
      bbox: [37.4, 55.6, 37.9, 55.9],
      centerCityId: 1,
      features: [],
    });
    assert.deepEqual(receivedViewport, {
      west: 37.4,
      south: 55.6,
      east: 37.9,
      north: 55.9,
      centerLng: 37.62,
      centerLat: 55.75,
    });

    const defaultCenter = await fetch(
      `${baseUrl}/api/geometries?bbox=37.4,55.6,37.9,55.9`,
    );
    assert.equal(defaultCenter.status, 200);
    assert.equal(receivedViewport.centerLng, 37.65);
    assert.equal(receivedViewport.centerLat, 55.75);

    for (const query of [
      '',
      '?bbox=37.4,55.6,37.4,55.9',
      '?bbox=37.4,55.6,37.9,55.9&center=40,55.75',
      '?bbox=west,55.6,37.9,55.9',
      '?bbox=-180,-90,180,90',
    ]) {
      const invalid = await fetch(`${baseUrl}/api/geometries${query}`);
      assert.equal(invalid.status, 400);
    }
  }, { repository });
});

test('root serves the optimized client without embedded GeoJSON', async () => {
  await withServer(async (baseUrl) => {
    const [response, markerResponse] = await Promise.all([
      fetch(baseUrl),
      fetch(`${baseUrl}/images/city-marker.png`),
    ]);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /id="city-list"/);
    assert.doesNotMatch(html, /FeatureCollection/);
    assert.equal(markerResponse.status, 200);
    assert.equal(markerResponse.headers.get('content-type'), 'image/png');
    const marker = Buffer.from(await markerResponse.arrayBuffer());
    assert.deepEqual([...marker.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  });
});

test('admin entry requires auth while static admin assets remain public', async () => {
  const authorization = `Basic ${Buffer.from('importer:test:secret').toString('base64')}`;
  await withServer(async (baseUrl) => {
    const unauthorized = await fetch(`${baseUrl}/admin/`);
    assert.equal(unauthorized.status, 401);
    const publicScript = await fetch(`${baseUrl}/admin/admin.js`);
    assert.equal(publicScript.status, 200);
    const authorized = await fetch(`${baseUrl}/admin/`, {
      headers: { Authorization: authorization },
    });
    assert.equal(authorized.status, 200);
    const html = await authorized.text();
    assert.match(html, /Администрирование/);
    assert.match(html, /role="tablist"/);
    assert.equal((html.match(/data-task-tab=/g) ?? []).length, 3);
    assert.equal((html.match(/data-task-action=/g) ?? []).length, 5);
    assert.match(html, /\/api\/admin\/export\/cities/);
    assert.match(html, /\/api\/admin\/export\/lines/);
    assert.match(html, /\/api\/admin\/export\/populations/);
    assert.match(html, /class="status-card"/);
    assert.match(html, /id="task-log" role="log"/);
    assert.doesNotMatch(html, /id="cancel-task"/);
  });
});

test('admin config exposes safe ENV defaults and exact OSM URLs', async () => {
  const authorization = `Basic ${Buffer.from('importer:test:secret').toString('base64')}`;
  await withServer(async (baseUrl) => {
    const unauthorized = await fetch(`${baseUrl}/api/admin/config`);
    assert.equal(unauthorized.status, 401);

    const response = await fetch(`${baseUrl}/api/admin/config`, {
      headers: { Authorization: authorization },
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /no-store/);
    const config = await response.json();
    assert.deepEqual(config.osmCityUpdate.allowedURLs, [
      'https://overpass-api.de/api/interpreter',
    ]);
    assert.deepEqual(config.osmCityUpdate.defaults, {
      URL: 'https://overpass-api.de/api/interpreter',
      batchSize: 50,
      minDelayMs: 5000,
      maxRetries: 6,
      retryBaseDelayMs: 30000,
      retryMaxDelayMs: 240000,
    });
    assert.deepEqual(config.kmlUpdate.defaults, {
      cityBufferMeters: 0,
    });
    assert.doesNotMatch(JSON.stringify(config), /password/i);
  });
});

test('admin status always exposes persistent successful update timestamps', async () => {
  const authorization = `Basic ${Buffer.from('importer:test:secret').toString('base64')}`;
  const initial = {
    taskType: 'kml-update',
    taskId: null,
    endpoint: '/api/admin/update',
    completedAt: '2026-08-31T12:00:00.000Z',
  };
  const adminTasks = createAdminTaskManager({
    initialSuccessfulUpdates: [initial],
  });
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/admin/status`, {
      headers: { Authorization: authorization },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: 'idle',
      taskId: null,
      task: null,
      lastSuccessfulUpdates: { 'kml-update': initial },
    });
  }, { adminTasks });
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

    const { completed } = await acceptAndWaitForAdminTask(
      response,
      baseUrl,
      authorization,
    );
    assert.equal(completed.status, 'succeeded');
    assert.deepEqual(completed.task.result, importResult);
    assert.equal(completed.task.type, 'geojson-import');
    assert.ok(completed.task.log.length >= 3);
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

    const { completed } = await acceptAndWaitForAdminTask(
      response,
      baseUrl,
      authorization,
    );
    assert.equal(completed.status, 'succeeded');
    assert.deepEqual(completed.task.result, populationResult);
    assert.equal(completed.task.type, 'population-update');
    assert.deepEqual(uploadedBody, body);
  }, { populationService });
});

test('KML update endpoint is protected and forwards explicit sources and overrides', async () => {
  let receivedBody;
  let receivedQuery;
  let calls = 0;
  const kmlUpdateService = {
    async update(body, query) {
      calls += 1;
      receivedBody = body;
      receivedQuery = query;
      return kmlUpdateResult;
    },
  };
  const body = [
    {
      URL: 'https://www.google.com/maps/d/viewer?mid=test-map',
      layers: [
        { name: 'Односторонние', multiple: 1 },
        { name: 'Двусторонние', multiple: 2 },
      ],
    },
  ];
  const authorization = `Basic ${Buffer.from('importer:test:secret').toString('base64')}`;

  await withServer(async (baseUrl) => {
    const unauthorized = await fetch(`${baseUrl}/api/admin/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal(unauthorized.status, 401);
    assert.equal(calls, 0);

    const response = await fetch(
      `${baseUrl}/api/admin/update?dryRun=true&unmatchedPolicy=skip`,
      {
        method: 'POST',
        headers: {
          Authorization: authorization,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );

    const { completed } = await acceptAndWaitForAdminTask(
      response,
      baseUrl,
      authorization,
    );
    assert.equal(completed.status, 'succeeded');
    assert.deepEqual(completed.task.result, kmlUpdateResult);
    assert.equal(completed.task.type, 'kml-update');
    assert.deepEqual(receivedBody, body);
    assert.equal(receivedQuery.dryRun, 'true');
    assert.equal(receivedQuery.unmatchedPolicy, 'skip');
  }, { kmlUpdateService });
});

test('OSM city update endpoint is protected and forwards URL and safe overrides', async () => {
  let receivedBody;
  let receivedQuery;
  let calls = 0;
  const osmCityUpdateService = {
    async update(body, query, operation) {
      calls += 1;
      receivedBody = body;
      receivedQuery = query;
      operation.onProgress({
        phase: 'retry',
        requestPhase: 'geometry',
        batch: 1,
        batchCount: 2,
        statusCode: 429,
        attempt: 1,
        maxRetries: 6,
        waitMs: 30000,
      });
      operation.onProgress({
        phase: 'geometry',
        batch: 1,
        batchCount: 2,
        stagedPlaces: 50,
        indexedPlaces: 100,
      });
      return osmCityUpdateResult;
    },
  };
  const body = { URL: 'https://overpass-api.de/api/interpreter' };
  const authorization = `Basic ${Buffer.from('importer:test:secret').toString('base64')}`;
  const adminTasks = createAdminTaskManager();

  await withServer(async (baseUrl) => {
    const unauthorized = await fetch(`${baseUrl}/api/admin/update/cities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal(unauthorized.status, 401);
    assert.equal(calls, 0);

    const response = await fetch(
      `${baseUrl}/api/admin/update/cities?dryRun=true&timeoutMs=5000&batchSize=25`,
      {
        method: 'POST',
        headers: {
          Authorization: authorization,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );
    assert.equal(response.status, 202);
    const accepted = await response.clone().json();

    const unauthorizedStatus = await fetch(
      `${baseUrl}${accepted.task.statusURL}`,
    );
    assert.equal(unauthorizedStatus.status, 401);

    const { completed } = await acceptAndWaitForAdminTask(
      response,
      baseUrl,
      authorization,
    );
    assert.equal(completed.status, 'succeeded');
    assert.deepEqual(completed.task.result, osmCityUpdateResult);
    assert.equal(completed.task.type, 'osm-city-update');
    assert.ok(completed.task.log.some((entry) =>
      entry.message === 'OSM: обработан пакет 1/2'));
    assert.ok(completed.task.log.some((entry) =>
      entry.message ===
        'OSM: HTTP 429, пакет 1/2; повтор 1/6 через 30 сек.'));
    assert.deepEqual(receivedBody, body);
    assert.equal(receivedQuery.dryRun, 'true');
    assert.equal(receivedQuery.timeoutMs, '5000');
    assert.equal(receivedQuery.batchSize, '25');
    assert.deepEqual(adminTasks.successfulUpdates(), {});
  }, { osmCityUpdateService, adminTasks });
});

test('one active admin task blocks every other mutating admin route', async () => {
  let finishKml;
  const kmlUpdateService = {
    update() {
      return new Promise((resolve) => {
        finishKml = () => resolve(kmlUpdateResult);
      });
    },
  };
  const authorization = `Basic ${Buffer.from('importer:test:secret').toString('base64')}`;
  const kmlBody = [{
    URL: 'https://www.google.com/maps/d/viewer?mid=single-lock',
    layers: [{ name: 'Линии', multiple: 1 }],
  }];
  const populationBody = {
    populations: [{ name: 'Казань', population: 1300000 }],
  };

  await withServer(async (baseUrl) => {
    const firstResponse = await fetch(`${baseUrl}/api/admin/update?dryRun=true`, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(kmlBody),
    });
    assert.equal(firstResponse.status, 202);
    const first = await firstResponse.json();

    const blockedResponse = await fetch(`${baseUrl}/api/admin/populations`, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(populationBody),
    });
    assert.equal(blockedResponse.status, 409);
    const blocked = await blockedResponse.json();
    assert.equal(blocked.taskId, first.taskId);
    assert.equal(blocked.task.type, 'kml-update');
    assert.equal(blocked.statusURL, first.task.statusURL);

    await new Promise((resolve) => setImmediate(resolve));
    finishKml();
    const completed = await waitForAdminTask(baseUrl, first, authorization);
    assert.equal(completed.status, 'succeeded');

    const secondResponse = await fetch(`${baseUrl}/api/admin/populations`, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(populationBody),
    });
    const second = await secondResponse.clone().json();
    assert.equal(secondResponse.status, 202);
    const oldStatus = await fetch(`${baseUrl}${first.task.statusURL}`, {
      headers: { Authorization: authorization },
    });
    assert.equal(oldStatus.status, 404);
    const secondCompleted = await acceptAndWaitForAdminTask(
      secondResponse,
      baseUrl,
      authorization,
    );
    assert.equal(secondCompleted.completed.status, 'succeeded');
    assert.notEqual(second.taskId, first.taskId);
  }, { kmlUpdateService });
});

test('admin cancellation aborts the active task and keeps its log', async () => {
  const osmCityUpdateService = {
    update(_body, _query, operation) {
      operation.onProgress({
        phase: 'index',
        indexPart: 1,
        indexPartCount: 4,
        indexedPlaces: 10,
      });
      return new Promise((_resolve, reject) => {
        operation.signal.addEventListener(
          'abort',
          () => reject(operation.signal.reason),
          { once: true },
        );
      });
    },
  };
  const authorization = `Basic ${Buffer.from('importer:test:secret').toString('base64')}`;

  await withServer(async (baseUrl) => {
    const startResponse = await fetch(
      `${baseUrl}/api/admin/update/cities?dryRun=true&batchSize=50`,
      { method: 'POST', headers: { Authorization: authorization } },
    );
    const started = await startResponse.json();
    assert.equal(startResponse.status, 202);
    await new Promise((resolve) => setImmediate(resolve));

    const cancelResponse = await fetch(
      `${baseUrl}/api/admin/cancel/${started.taskId}`,
      { method: 'POST', headers: { Authorization: authorization } },
    );
    assert.equal(cancelResponse.status, 202);
    assert.equal((await cancelResponse.json()).taskId, started.taskId);

    const cancelled = await waitForAdminTask(baseUrl, started, authorization);
    assert.equal(cancelled.status, 'cancelled');
    assert.ok(cancelled.task.log.some((entry) =>
      entry.message === 'Запрошена отмена задачи'));
    assert.ok(cancelled.task.log.some((entry) =>
      entry.message === 'Задача отменена'));

    const repeated = await fetch(
      `${baseUrl}/api/admin/cancel/${started.taskId}`,
      { method: 'POST', headers: { Authorization: authorization } },
    );
    assert.equal(repeated.status, 409);
  }, { osmCityUpdateService });
});
