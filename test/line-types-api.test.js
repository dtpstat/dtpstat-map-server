import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import test from 'node:test';
import { createLineTypesRouter } from '../src/routes/line-types-api.js';

const authorization = `Basic ${Buffer.from('importer:test-secret').toString('base64')}`;
const lineTypes = [
  {
    id: 1,
    code: 0,
    name: 'default',
    title: 'Выделенные полосы',
    color: '#045b69',
    style: 'solid',
    width: 4,
    geometryCount: 12,
  },
];

function requireInterface(request, response, next) {
  if (request.get('authorization') !== authorization) {
    response.status(401).json({ error: 'Authentication required' });
    return;
  }
  request.adminUser = { id: 1, username: 'importer', canManageInterface: true };
  next();
}

async function withServer(callback, options = {}) {
  let savedPayload;
  const repository = options.repository ?? {
    async list() { return lineTypes; },
    async save(payload) {
      savedPayload = payload;
      return lineTypes;
    },
  };
  const app = express();
  app.use('/api', createLineTypesRouter({
    lineTypesRepository: repository,
    adminAuth: { requireInterface },
    securityService: { async appendAudit() {} },
    maxBodyBytes: 1024 * 1024,
  }));
  app.use((error, _request, response, _next) => {
    if (error?.type === 'entity.parse.failed') {
      response.status(400).json({ error: 'Request body is not valid JSON' });
      return;
    }
    response.status(503).json({ error: error.message });
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    await callback(`http://127.0.0.1:${address.port}`, () => savedPayload);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test('public line type API exposes code, import name, title and styles', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/line-types`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { lineTypes });
  });
});

test('admin line type update requires auth and saves only editable settings', async () => {
  await withServer(async (baseUrl, savedPayload) => {
    const body = {
      lineTypes: [{
        code: 0,
        title: 'Основные полосы',
        color: '#123456',
        style: 'dotted',
        width: 5,
      }],
    };

    const unauthorized = await fetch(`${baseUrl}/api/admin/line-types`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal(unauthorized.status, 401);

    const response = await fetch(`${baseUrl}/api/admin/line-types`, {
      method: 'PUT',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(savedPayload(), body);
    assert.deepEqual(await response.json(), { lineTypes });
  });
});

test('admin line type update rejects a missing JSON content type', async () => {
  await withServer(async (baseUrl, savedPayload) => {
    const response = await fetch(`${baseUrl}/api/admin/line-types`, {
      method: 'PUT',
      headers: { Authorization: authorization },
      body: 'not-json',
    });
    assert.equal(response.status, 415);
    assert.equal(savedPayload(), undefined);
  });
});
