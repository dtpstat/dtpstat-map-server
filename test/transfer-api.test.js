import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import { once } from 'node:events';
import { createReadStream } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createApp } from '../src/app.js';
import {
  createSingleFileZipStream,
  openSingleFileZip,
} from '../src/data/single-file-zip.js';

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
  schemaVersion: 2,
  exportedAt: '2026-09-05T12:00:00.000Z',
  regions: [],
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

async function readJsonStream(source) {
  const chunks = [];
  for await (const chunk of source) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function withStreamingMethod(service, streamingName, legacyName) {
  if (typeof service?.[streamingName] === 'function') return service;
  if (typeof service?.[legacyName] !== 'function') return service;
  return {
    ...service,
    async [streamingName](source, operation) {
      return service[legacyName](await readJsonStream(source), operation);
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
    importService: withStreamingMethod(
      overrides.importService ?? {
        async replaceFromGeoJson() { return { geometries: 0 }; },
      },
      'replaceFromGeoJsonStream',
      'replaceFromGeoJson',
    ),
    cityBoundaryTransferService: withStreamingMethod(
      overrides.cityBoundaryTransferService ?? {
        async replaceFromGeoJson() { return { importedPlaces: 0 }; },
      },
      'replaceFromGeoJsonStream',
      'replaceFromGeoJson',
    ),
    populationService: withStreamingMethod(
      overrides.populationService ?? {
        async updateFromJson() { return { cities: 0 }; },
      },
      'updateFromJsonStream',
      'updateFromJson',
    ),
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

async function collect(source) {
  const chunks = [];
  for await (const chunk of source) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function directoryInfo(buffer) {
  const eocd = buffer.length - 22;
  assert.equal(buffer.readUInt32LE(eocd), 0x06054b50);
  const entries = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  const zip64 =
    entries === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff;

  if (!zip64) {
    return {
      eocd,
      zip64: false,
      zip64Eocd: null,
      centralOffset,
    };
  }

  const locator = eocd - 20;
  assert.equal(buffer.readUInt32LE(locator), 0x07064b50);
  const zip64Eocd = Number(buffer.readBigUInt64LE(locator + 8));
  assert.equal(buffer.readUInt32LE(zip64Eocd), 0x06064b50);
  return {
    eocd,
    zip64: true,
    zip64Eocd,
    centralOffset: Number(buffer.readBigUInt64LE(zip64Eocd + 48)),
  };
}

async function postChunked(baseUrl, pathname, source, headers = {}) {
  const target = new URL(pathname, baseUrl);
  return new Promise((resolve, reject) => {
    const request = http.request(target, {
      method: 'POST',
      headers: {
        ...headers,
        'Transfer-Encoding': 'chunked',
      },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('error', reject);
      response.on('end', () => {
        resolve({
          status: response.statusCode,
          headers: response.headers,
          body: Buffer.concat(chunks),
        });
      });
    });
    request.on('error', reject);

    void (async () => {
      try {
        for await (const chunk of source) {
          if (!request.write(chunk)) await once(request, 'drain');
        }
        request.end();
      } catch (error) {
        request.destroy(error);
      }
    })();
  });
}

async function zipBuffer(fileName, payload) {
  return collect(createSingleFileZipStream(
    fileName,
    [Buffer.from(JSON.stringify(payload))],
  ));
}

function sevenZipAvailable() {
  return spawnSync('7z', ['i'], { stdio: 'ignore' }).status === 0;
}

async function createSevenZipFromStdin(file, payload) {
  const child = spawn(
    '7z',
    ['a', '-tzip', '-mx=6', file, '-si'],
    { stdio: ['pipe', 'ignore', 'pipe'] },
  );
  const errors = [];
  child.stderr.on('data', (chunk) => errors.push(Buffer.from(chunk)));
  child.stdin.end(Buffer.from(JSON.stringify(payload)));
  const [code] = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (...args) => resolve(args));
  });
  if (code !== 0) {
    const message = Buffer.concat(errors).toString('utf8');
    if (/E_NOTIMPL|not implemented/i.test(message)) return false;
    throw new Error(
      `7z failed with exit code ${code}: ` + message,
    );
  }
  return true;
}

async function readZipBuffer(buffer) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dtpstat-api-zip-'));
  const file = path.join(directory, 'response.zip');
  try {
    await fs.writeFile(file, buffer);
    const entry = await openSingleFileZip(file, {
      maxUncompressedBytes: 16 * 1024 * 1024,
    });
    return {
      fileName: entry.fileName,
      payload: JSON.parse((await collect(entry.stream)).toString('utf8')),
    };
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
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
      ['/api/admin/export/cities', 'cities.geojson', citySnapshot],
      ['/api/admin/export/lines', 'lines.geojson', lineSnapshot],
      ['/api/admin/export/populations', 'populations.json', populationSnapshot],
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

test('portable ZIP exports contain exactly one JSON/GeoJSON file', async () => {
  await withServer(async (baseUrl) => {
    const expectations = [
      ['/api/admin/export/cities.zip', 'cities.zip', 'cities.geojson', citySnapshot],
      ['/api/admin/export/lines.zip', 'lines.zip', 'lines.geojson', lineSnapshot],
      [
        '/api/admin/export/populations.zip',
        'populations.zip',
        'populations.json',
        populationSnapshot,
      ],
    ];

    for (const [endpoint, downloadName, entryName, expected] of expectations) {
      const response = await fetch(`${baseUrl}${endpoint}`, {
        headers: { Authorization: authorization },
      });
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type') ?? '', /application\/zip/);
      assert.match(
        response.headers.get('content-disposition') ?? '',
        new RegExp(`filename="${downloadName.replace('.', '\\.')}"`),
      );
      const parsed = await readZipBuffer(
        Buffer.from(await response.arrayBuffer()),
      );
      assert.equal(parsed.fileName, entryName);
      assert.deepEqual(parsed.payload, expected);
    }
  });
});

test('single-file ZIP import is decoded before the transactional service task', async () => {
  let received;
  const service = {
    async replaceFromGeoJson(payload) {
      received = payload;
      return { geometries: payload.features.length };
    },
  };
  const payload = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { short_name: 'Казань', lanes: 1 },
      geometry: {
        type: 'LineString',
        coordinates: [[49, 55], [49.1, 55.1]],
      },
    }],
  };
  const archive = await zipBuffer('lines.geojson', payload);

  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/admin/import/lines`, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/zip',
      },
      body: archive,
    });
    assert.equal(response.status, 202);
    const accepted = await response.json();
    const completed = await waitForTask(baseUrl, accepted);
    assert.equal(completed.status, 'succeeded');
    assert.deepEqual(received, payload);
  }, { importService: service });
});

test('chunked ZIP64 import accepts an stdin-style entry with unknown source size', async () => {
  let received;
  const payload = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { short_name: 'Поток', lanes: 1 },
      geometry: {
        type: 'LineString',
        coordinates: [[30, 60], [30.1, 60.1]],
      },
    }],
  };
  const json = Buffer.from(JSON.stringify(payload));
  const archive = createSingleFileZipStream(
    'stdin',
    (async function* () {
      for (let offset = 0; offset < json.length; offset += 13) {
        yield json.subarray(offset, offset + 13);
      }
    })(),
  );

  await withServer(async (baseUrl) => {
    const response = await postChunked(
      baseUrl,
      '/api/admin/import/lines',
      archive,
      {
        Authorization: authorization,
        'Content-Type': 'application/zip',
      },
    );
    assert.equal(response.status, 202);
    const accepted = JSON.parse(response.body.toString('utf8'));
    const completed = await waitForTask(baseUrl, accepted);
    assert.equal(completed.status, 'succeeded');
    assert.deepEqual(received, payload);
  }, {
    importService: {
      async replaceFromGeoJson(body) {
        received = body;
        return { geometries: body.features.length };
      },
    },
  });
});

test(
  'chunked HTTP import accepts ZIP produced by 7-Zip from stdin',
  { skip: !sevenZipAvailable() },
  async (context) => {
    let received;
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'dtpstat-7z-http-'),
    );
    const archivePath = path.join(directory, 'stdin.zip');
    const payload = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: { short_name: '7z поток', lanes: 1 },
        geometry: {
          type: 'LineString',
          coordinates: [[37, 55], [37.1, 55.1]],
        },
      }],
    };

    try {
      if (!await createSevenZipFromStdin(archivePath, payload)) {
        context.skip('installed 7-Zip does not support creating ZIP from stdin');
        return;
      }

      await withServer(async (baseUrl) => {
        const response = await postChunked(
          baseUrl,
          '/api/admin/import/lines',
          createReadStream(archivePath, { highWaterMark: 17 }),
          {
            Authorization: authorization,
            'Content-Type': 'application/zip',
          },
        );
        assert.equal(response.status, 202);
        const accepted = JSON.parse(response.body.toString('utf8'));
        const completed = await waitForTask(baseUrl, accepted);
        assert.equal(completed.status, 'succeeded');
        assert.deepEqual(received, payload);
      }, {
        importService: {
          async replaceFromGeoJson(body) {
            received = body;
            return { geometries: body.features.length };
          },
        },
      });
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  },
);

test('ZIP import with more than one entry fails the admin task', async () => {
  const archive = await zipBuffer('lines.geojson', lineSnapshot);
  const directory = directoryInfo(archive);
  if (directory.zip64) {
    archive.writeBigUInt64LE(2n, directory.zip64Eocd + 24);
    archive.writeBigUInt64LE(2n, directory.zip64Eocd + 32);
  } else {
    archive.writeUInt16LE(2, directory.eocd + 8);
    archive.writeUInt16LE(2, directory.eocd + 10);
  }

  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/admin/import/lines`, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/zip',
      },
      body: archive,
    });
    assert.equal(response.status, 202);
    const accepted = await response.json();
    const completed = await waitForTask(baseUrl, accepted);
    assert.equal(completed.status, 'failed');
    assert.match(
      completed.task.error.message,
      /entry count|exactly one ordinary entry/,
    );
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
    schemaVersion: 2,
    regions: [{
      name: 'Республика Татарстан',
      attributes: {},
      cities: [{
        name: 'Казань',
        population: 1300000,
        attributes: {},
      }],
    }],
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
