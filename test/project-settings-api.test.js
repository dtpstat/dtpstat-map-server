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
    yandexMetrikaId: null,
    googleAnalyticsId: null,
    themePreset: 'classic',
    showLineLabels: false,
    showLinePopups: true,
    mapboxAccessTokenConfigured: false,
    updatedAt: '2026-09-05T12:00:00.000Z',
  };
  return {
    async get() { return settings; },
    async save(payload) {
      const {
        showLineLabels = false,
        showLinePopups = settings.showLinePopups,
        mapboxAccessToken = null,
        ...base
      } = payload;
      settings = {
        ...buildProjectSettingsPlan(base),
        showLineLabels,
        showLinePopups,
        mapboxAccessTokenConfigured: Boolean(mapboxAccessToken),
        updatedAt: '2026-09-05T13:00:00.000Z',
      };
      return settings;
    },
  };
}

function adminAuth() {
  return {
    requireInterface(request, response, next) {
      if (request.get('authorization') !== authorization) {
        response.status(401).json({ error: 'Unauthorized' });
        return;
      }
      request.adminUser = { id: 1, username: 'importer' };
      request.adminAuthMethod = 'basic';
      next();
    },
  };
}

async function withServer(callback) {
  const app = express();
  app.use('/api', createProjectSettingsRouter({
    projectSettingsRepository: createRepository(),
    adminAuth: adminAuth(),
    securityService: { async appendAudit() {} },
    maxBodyBytes: 1024 * 1024,
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
    const publicSettings = await publicResponse.json();
    assert.equal(publicSettings.projectName, 'Выделенные полосы в России');
    assert.equal(publicSettings.themePreset, 'classic');
    assert.equal(publicSettings.showLineLabels, false);
    assert.equal(publicSettings.showLinePopups, true);
    assert.equal(publicSettings.yandexMetrikaId, null);
    assert.equal(publicSettings.googleAnalyticsId, null);

    const unauthorized = await fetch(`${baseUrl}/api/admin/project-settings`);
    assert.equal(unauthorized.status, 401);

    const response = await fetch(`${baseUrl}/api/admin/project-settings`, {
      headers: { Authorization: authorization },
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.settings.projectName, 'Выделенные полосы в России');
    assert.equal(payload.settings.showLinePopups, true);
    assert.ok(payload.editor.tags.includes('h2'));
    assert.ok(payload.editor.classes.includes('project-callout'));
    assert.deepEqual(
      payload.editor.themes.map(({ value }) => value),
      ['retro', 'classic', 'modern'],
    );
  });
});

test('admin can update project settings including independent line labels and popups', async () => {
  await withServer(async (baseUrl) => {
    const valid = await fetch(`${baseUrl}/api/admin/project-settings`, {
      method: 'PUT',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        projectName: 'Трамвайные пути России',
        themePreset: 'modern',
        showLineLabels: true,
        showLinePopups: false,
        keywords: ['трамвай', 'обособление'],
        yandexMetrikaId: '12345678',
        googleAnalyticsId: 'g-ab12cd34ef',
        footerHtml: '<h2>О проекте</h2><div class="project-callout"><p>Текст</p></div>',
      }),
    });
    assert.equal(valid.status, 200);
    const payload = await valid.json();
    assert.equal(payload.settings.projectName, 'Трамвайные пути России');
    assert.equal(payload.settings.themePreset, 'modern');
    assert.equal(payload.settings.showLineLabels, true);
    assert.equal(payload.settings.showLinePopups, false);
    assert.equal(payload.settings.yandexMetrikaId, '12345678');
    assert.equal(payload.settings.googleAnalyticsId, 'G-AB12CD34EF');

    const invalidTheme = await fetch(`${baseUrl}/api/admin/project-settings`, {
      method: 'PUT',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        projectName: 'Трамвайные пути России',
        themePreset: 'external.css',
        keywords: [],
        footerHtml: '<p>Текст</p>',
      }),
    });
    assert.equal(invalidTheme.status, 400);
    assert.match((await invalidTheme.json()).error, /themePreset/);
  });
});

test('admin still rejects invalid analytics and unsafe footer HTML', async () => {
  await withServer(async (baseUrl) => {
    const invalidAnalytics = await fetch(`${baseUrl}/api/admin/project-settings`, {
      method: 'PUT',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        projectName: 'Трамвайные пути России',
        keywords: [],
        yandexMetrikaId: 'not-a-counter',
        googleAnalyticsId: 'UA-123-1',
        footerHtml: '<p>Текст</p>',
      }),
    });
    assert.equal(invalidAnalytics.status, 400);
    assert.match((await invalidAnalytics.json()).error, /Metrika|Analytics|counter|G-/i);

    const invalidHtml = await fetch(`${baseUrl}/api/admin/project-settings`, {
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
    assert.equal(invalidHtml.status, 400);
    assert.match((await invalidHtml.json()).error, /not allowed/);
  });
});