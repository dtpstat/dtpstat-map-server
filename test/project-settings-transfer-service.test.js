import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createProjectSettingsTransferService,
  ProjectSettingsTransferValidationError,
} from '../src/db/project-settings-transfer-service.js';

function exportPool() {
  const client = {
    async query(text) {
      if (/BEGIN ISOLATION LEVEL/i.test(text)) return { rows: [] };
      if (/FROM project_settings/i.test(text)) {
        return {
          rows: [{
            projectName: 'Тестовый проект',
            keywords: ['карта'],
            footerHtml: '<p>Описание</p>',
            yandexMetrikaId: null,
            googleAnalyticsId: null,
            showLineLabels: true,
            mapboxAccessToken: 'pk.test-public-token-value',
          }],
        };
      }
      if (/FROM line_types/i.test(text)) {
        return {
          rows: [{
            code: 0,
            name: 'default',
            title: 'Линии',
            color: '#045b69',
            style: 'solid',
            width: 4,
          }],
        };
      }
      if (/FROM report_config/i.test(text)) {
        return {
          rows: [{
            metrics: [{
              key: 'population',
              name: 'Население',
              source: { kind: 'field', field: 'city.population' },
              operations: [],
            }],
            tableColumns: [
              { kind: 'city', title: 'город' },
              {
                kind: 'metric',
                metricKey: 'population',
                title: 'население',
                scale: 1,
                decimals: 0,
                formatRules: [],
              },
            ],
            csvColumns: [
              { kind: 'city', title: 'city' },
              {
                kind: 'metric',
                metricKey: 'population',
                title: 'population',
                scale: 1,
                decimals: null,
              },
            ],
            rankMetricKey: 'population',
            rankDirection: 'desc',
          }],
        };
      }
      if (/FROM admin_security_settings/i.test(text)) {
        return {
          rows: [{
            maxFailedAttempts: 5,
            failureWindowSeconds: 900,
            lockoutSeconds: 900,
          }],
        };
      }
      if (/COMMIT/i.test(text)) return { rows: [] };
      throw new Error(`Unexpected SQL in fake: ${text}`);
    },
    release() {},
  };
  return { async connect() { return client; } };
}

test('settings export contains project configuration but no users, password hashes or audit log', async () => {
  const service = createProjectSettingsTransferService(exportPool());
  const payload = await service.exportSettings();

  assert.equal(payload._dtpstat.kind, 'project-settings');
  assert.equal(payload._dtpstat.schemaVersion, 2);
  assert.equal(payload.projectSettings.showLineLabels, true);
  assert.equal(payload.projectSettings.mapboxAccessToken, 'pk.test-public-token-value');
  assert.equal(payload.lineTypes[0].name, 'default');
  assert.equal(payload.reportConfig.rank.metricKey, 'population');
  assert.equal(payload.securitySettings.maxFailedAttempts, 5);

  const json = JSON.stringify(payload);
  assert.doesNotMatch(json, /passwordHash|PASSWORD_HASH|adminUsers|auditLog/i);
});

test('settings import rejects another transfer kind before opening a database transaction', async () => {
  let connected = false;
  const service = createProjectSettingsTransferService({
    async connect() {
      connected = true;
      throw new Error('must not connect');
    },
  });

  await assert.rejects(
    service.importSettings({
      _dtpstat: { kind: 'lines', schemaVersion: 1 },
    }),
    (error) => error instanceof ProjectSettingsTransferValidationError && /kind/.test(error.message),
  );
  assert.equal(connected, false);
});

test('settings import rejects unsupported schema versions before touching the database', async () => {
  let connected = false;
  const service = createProjectSettingsTransferService({
    async connect() {
      connected = true;
      throw new Error('must not connect');
    },
  });

  await assert.rejects(
    service.importSettings({
      _dtpstat: { kind: 'project-settings', schemaVersion: 3 },
    }),
    (error) => error instanceof ProjectSettingsTransferValidationError && /schemaVersion/.test(error.message),
  );
  assert.equal(connected, false);
});
