import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import test from 'node:test';
import { createLineTypesRouter } from '../src/routes/line-types-api.js';

const authorization = `Basic ${Buffer.from('importer:test-secret').toString('base64')}`;
const lineTypes = [
  {
    id: 1,
    type: 'default',
    name: 'Выделенные полосы',
    color: '#045b69',
    style: 'solid',
    width: 4,
    geometryCount: 12,
  },
];

async function withServer(callback, options = {}) {
  let savedPayload;
  const repository = options.repository ?? {
    async list() {
      return lineTypes;
    },
    async save(payload) {
      savedPayload = payload;
      return lineTypes;
    },
  };
  const adminTasks = options.adminTasks ?? { active: () => null };
  const app = express();
  app.use('/api', createLineTypesRouter({
    lineTypesRepository: repository,
    adminTasks,
    importApi: {
      username: 'importer',
      password: 'test-secret',
      maxBodyBytes: 1024 * 1024,
    },
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

test('public line type API exposes styles and geometry counts', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/line-types`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /max-age=300/);
    assert.deepEqual(await response.json(), { lineTypes });
  });
});

test('admin line type update requires Basic Auth and saves a complete list', async () => {
  await withServer(async (baseUrl, savedPayload) => {
    const body = {
      lineTypes: [{
        type: 'default',
        name: 'Основные полосы',
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

test('admin line type update is blocked while a data task is active', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/admin/line-types`, {
      method: 'PUT',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ lineTypes: [] }),
    });
    assert.equal(response.status, 409);
    const payload = await response.json();
    assert.equal(payload.taskId, 'task-1');
    assert.equal(payload.task.type, 'kml-update');
  }, {
    adminTasks: {
      active() {
        return { id: 'task-1', type: 'kml-update', status: 'running' };
      },
    },
  });
});
