import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import test from 'node:test';
import { CITY_MARKER_ICON } from '../public/js/city-marker-icon.js';
import { createProjectSettingsRouter } from '../src/routes/project-settings-api.js';

const bundledPng = Buffer.from(CITY_MARKER_ICON.split(',')[1], 'base64');

async function withServer(callback) {
  let customIcon = null;
  const repository = {
    async get() {
      return {
        projectName: 'Test',
        keywords: [],
        footerHtml: '<p>Test</p>',
        yandexMetrikaId: null,
        googleAnalyticsId: null,
        showLineLabels: false,
        mapboxAccessTokenConfigured: true,
        cityMarkerIconConfigured: Boolean(customIcon),
        cityMarkerIconWidth: customIcon?.width ?? null,
        cityMarkerIconHeight: customIcon?.height ?? null,
        updatedAt: '2026-09-06T00:00:00.000Z',
      };
    },
    async save(payload) { return payload; },
    async getCityMarkerIcon() { return customIcon; },
    async saveCityMarkerIcon(icon) {
      customIcon = icon;
      return {
        cityMarkerIconConfigured: true,
        cityMarkerIconWidth: icon.width,
        cityMarkerIconHeight: icon.height,
        updatedAt: '2026-09-06T01:00:00.000Z',
      };
    },
    async clearCityMarkerIcon() {
      customIcon = null;
      return {
        cityMarkerIconConfigured: false,
        cityMarkerIconWidth: null,
        cityMarkerIconHeight: null,
        updatedAt: '2026-09-06T02:00:00.000Z',
      };
    },
  };
  const adminAuth = {
    requireInterface(request, _response, next) {
      request.adminUser = { id: 1, username: 'admin', canManageInterface: true };
      next();
    },
  };
  const securityService = { async appendAudit() {} };
  const app = express();
  app.use('/api', createProjectSettingsRouter({
    projectSettingsRepository: repository,
    adminAuth,
    securityService,
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

test('city marker API serves fallback, accepts PNG and can reset it', async () => {
  await withServer(async (baseUrl) => {
    const fallback = await fetch(`${baseUrl}/api/city-marker-icon`);
    assert.equal(fallback.status, 200);
    assert.equal(fallback.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await fallback.arrayBuffer()), bundledPng);

    const upload = await fetch(`${baseUrl}/api/admin/project-settings/city-marker-icon`, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: bundledPng,
    });
    assert.equal(upload.status, 200);
    const uploadPayload = await upload.json();
    assert.equal(uploadPayload.settings.cityMarkerIconConfigured, true);
    assert.equal(uploadPayload.settings.cityMarkerIconWidth, 32);

    const configured = await fetch(`${baseUrl}/api/city-marker-icon`);
    assert.deepEqual(Buffer.from(await configured.arrayBuffer()), bundledPng);

    const reset = await fetch(`${baseUrl}/api/admin/project-settings/city-marker-icon`, {
      method: 'DELETE',
    });
    assert.equal(reset.status, 200);
    assert.equal((await reset.json()).settings.cityMarkerIconConfigured, false);
  });
});

test('city marker upload rejects non-PNG content type', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/admin/project-settings/city-marker-icon`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: bundledPng,
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /image\/png/i);
  });
});
