import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import test from 'node:test';
import { parseLinesKml } from '../src/data/kml-transfer.js';
import { createKmlTransferRouter } from '../src/routes/kml-transfer-api.js';

const authorization = `Basic ${Buffer.from('importer:test-secret').toString('base64')}`;

const snapshot = {
  type: 'FeatureCollection',
  schemaVersion: 3,
  lineTypes: [
    { code: 0, name: 'default', title: 'Обычные', color: '#045b69', style: 'solid', width: 4 },
    { code: 7, name: 'Односторонние', title: 'Односторонние полосы', color: '#cc4400', style: 'dashed', width: 5 },
  ],
  features: [
    {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[30, 60], [30.1, 60.1]] },
      properties: {
        short_name: 'Тестоград',
        name: 'Тестоград',
        lanes: 1,
        _dtpstat: {
          citySlug: 'testograd',
          boundaryOsmType: 'relation',
          boundaryOsmId: 123,
          businessTypeCode: 7,
        },
      },
    },
  ],
};

function requireData(request, response, next) {
  if (request.get('authorization') !== authorization) {
    response.status(401).json({ error: 'Authentication required' });
    return;
  }
  request.adminUser = { id: 1, username: 'importer', canManageData: true };
  next();
}

async function withServer(callback) {
  let importedCollection = null;
  let taskDefinition = null;
  let taskPromise = Promise.resolve();
  const adminTasks = {
    active() { return null; },
    start(definition, executor) {
      taskDefinition = definition;
      taskPromise = Promise.resolve(executor({
        signal: undefined,
        beginCommit() {},
        log() {},
      }));
      return {
        id: 'task-kml-1',
        type: definition.type,
        status: 'queued',
        createdAt: '2026-09-06T00:00:00.000Z',
      };
    },
  };
  const app = express();
  app.use('/api', createKmlTransferRouter({
    exportRepository: {
      async exportLines() { return snapshot; },
    },
    importService: {
      async replaceFromGeoJson(collection) {
        importedCollection = collection;
        return { geometries: collection.features.length };
      },
    },
    adminTasks,
    adminAuth: { requireData },
    securityService: { async appendAudit() {} },
    maxBodyBytes: 1024 * 1024,
  }));
  app.use((error, _request, response, _next) => {
    response.status(503).json({ error: error.message });
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    await callback(`http://127.0.0.1:${address.port}`, {
      getImported: () => importedCollection,
      getTaskDefinition: () => taskDefinition,
      waitForTask: () => taskPromise,
    });
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test('portable KML export requires auth and carries numeric code/name/title dictionary', async () => {
  await withServer(async (baseUrl) => {
    const unauthorized = await fetch(`${baseUrl}/api/admin/export/lines.kml`);
    assert.equal(unauthorized.status, 401);

    const response = await fetch(`${baseUrl}/api/admin/export/lines.kml`, {
      headers: { Authorization: authorization },
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /vnd\.google-earth\.kml\+xml/);
    assert.match(response.headers.get('content-disposition') ?? '', /filename="lines\.kml"/);
    const xml = await response.text();
    assert.match(xml, /dtpstat\.businessLineTypes/);
    const parsed = parseLinesKml(xml);
    assert.equal(parsed.lineTypes[1].code, 7);
    assert.equal(parsed.lineTypes[1].name, 'Односторонние');
    assert.equal(parsed.lineTypes[1].title, 'Односторонние полосы');
    assert.equal(parsed.lineTypes[1].style, 'dashed');
  });
});

test('portable KML import parses metadata before starting the database task', async () => {
  await withServer(async (baseUrl, state) => {
    const exportResponse = await fetch(`${baseUrl}/api/admin/export/lines.kml`, {
      headers: { Authorization: authorization },
    });
    const xml = await exportResponse.text();

    const response = await fetch(`${baseUrl}/api/admin/import/lines.kml`, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/vnd.google-earth.kml+xml',
      },
      body: xml,
    });
    assert.equal(response.status, 202);
    await state.waitForTask();
    assert.equal(state.getTaskDefinition().type, 'kml-update');
    assert.equal(state.getTaskDefinition().parameters.mode, 'portable-kml');
    assert.deepEqual(state.getImported().lineTypes, snapshot.lineTypes);
    assert.equal(state.getImported().features[0].geometry.type, 'LineString');
    assert.equal(
      state.getImported().features[0].properties._dtpstat.businessTypeCode,
      7,
    );
  });
});

test('portable KML rejects malformed business metadata without starting a task', async () => {
  await withServer(async (baseUrl, state) => {
    const response = await fetch(`${baseUrl}/api/admin/import/lines.kml`, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/vnd.google-earth.kml+xml',
      },
      body: '<kml><Document><Placemark/></Document></kml>',
    });
    assert.equal(response.status, 400);
    assert.equal(state.getTaskDefinition(), null);
    assert.equal(state.getImported(), null);
  });
});
