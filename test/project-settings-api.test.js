import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import test from 'node:test';
import { buildProjectSettingsPlan } from '../src/data/project-settings.js';
import { createProjectSettingsRouter } from '../src/routes/project-settings-api.js';

const authorization = `Basic ${Buffer.from('importer:test:secret').toString('base64')}`;

function createRepository() {
  let settings = {
    projectName: 'Выделенные полосы в России',
    keywords: ['транспорт'],
    footerHtml: '<h2>О проекте</h2><p>Текст</p>',
    updatedAt: '2026-09-05T12:00:00.000Z',
  };
  return {
    async get() { return settings; },
    async save(payload) {
      settings = {
        ...buildProjectSettingsPlan(payload),
        updatedAt: '2026-09-05T13:00:00.000Z',
      };
      return settings;
    },
  };
}

async function withServer(callback, { activeTask = null } = {}) {
  const app = express();
  app.use('/api', createProjectSettingsRouter({
    projectSettingsRepository: createRepository(),
    adminTasks: { active: () => activeTask },
    importApi: {
      username: 'importer',
      password: 'test:secret',
      maxBodyBytes: 1024 * 1024,
    },
  }));
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

test('public project settings are readable while admin editor remains protected', async () => {
  await withServer(async (baseUrl) => {
    const publicResponse = await fetch(`${baseUrl}/api/project`);
    assert.equal(publicResponse.status, 200);
    assert.equal((await publicResponse.json()).projectName, 'Выделенные полосы в России');

    const unauthorized = await fetch(`${baseUrl}/api/admin/project-settings`);
    assert.equal(unauthorized.status, 401);

    const response = await fetch(`${baseUrl}/api/admin/project-settings`, {
      headers: { Authorization: authorization },
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.settings.projectName, 'Выделенные полосы в России');
    assert.ok(payload.editor.tags.includes('h2'));
    assert.ok(payload.editor.classes.includes('project-callout'));
  });
});

test('admin can update project settings and unsafe footer HTML is rejected', async () => {
  await withServer(async (baseUrl) => {
    const valid = await fetch(`${baseUrl}/api/admin/project-settings`, {
      method: 'PUT',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        projectName: 'Трамвайные пути России',
        keywords: ['трамвай', 'обособление'],
        footerHtml: '<h2>О проекте</h2><div class="project-callout"><p>Текст</p></div>',
      }),
    });
    assert.equal(valid.status, 200);
    const payload = await valid.json();
    assert.equal(payload.settings.projectName, 'Трамвайные пути России');

    const invalid = await fetch(`${baseUrl}/api/admin/project-settings`, {
      method: 'PUT',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        projectName: 'Трамвайные пути России',
        keywords: [],
        footerHtml: '<script>alert(1)</script>',
      }),
    });
    assert.equal(invalid.status, 400);
    assert.match((await invalid.json()).error, /not allowed/);
  });
});

test('project settings update is blocked while a data task is active', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/admin/project-settings`, {
      method: 'PUT',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        projectName: 'Проект',
        keywords: [],
        footerHtml: '<p>Текст</p>',
      }),
    });
    assert.equal(response.status, 409);
    const payload = await response.json();
    assert.equal(payload.taskId, 'active-task');
  }, {
    activeTask: {
      id: 'active-task',
      type: 'kml-update',
      status: 'running',
    },
  });
});
