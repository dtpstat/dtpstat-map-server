import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createProjectSettingsTransferRuntime,
} from '../src/application/project-report-runtime.js';
import {
  ProjectSettingsTransferValidationError,
} from '../src/application/data-transfer/project-settings-service.js';

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
            themePreset: 'modern',
            showLineLabels: true,
            showLinePopups: false,
            largeCityPopulationThreshold: 400000,
            largeCityAreaKm2Threshold: 250,
            publicDownloadName: 'tram-lines',
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
            config: {
              metrics: [
                {
                  key: 'population',
                  name: 'Население',
                  source: { kind: 'field', field: 'city.population' },
                  operations: [],
                },
                {
                  key: 'area',
                  name: 'Площадь',
                  source: { kind: 'field', field: 'city.area_m2' },
                  operations: [],
                },
              ],
              table_columns: [
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
              csv_columns: [
                { kind: 'city', title: 'city' },
                {
                  kind: 'metric',
                  metricKey: 'population',
                  title: 'population',
                  scale: 1,
                  decimals: null,
                },
              ],
              rank: {
                sort: [
                  { metricKey: 'population', direction: 'desc' },
                  { metricKey: 'area', direction: 'asc' },
                ],
              },
            },
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

test('settings export contains download name, sequential ranking and line display settings but no private admin data', async () => {
  const service = createProjectSettingsTransferRuntime(exportPool());
  const payload = await service.exportSettings();

  assert.equal(payload._dtpstat.kind, 'project-settings');
  assert.equal(payload._dtpstat.schemaVersion, 8);
  assert.equal(payload.projectSettings.themePreset, 'modern');
  assert.equal(payload.projectSettings.showLineLabels, true);
  assert.equal(payload.projectSettings.showLinePopups, false);
  assert.equal(payload.projectSettings.largeCityPopulationThreshold, 400000);
  assert.equal(payload.projectSettings.largeCityAreaKm2Threshold, 250);
  assert.equal(payload.projectSettings.publicDownloadName, 'tram-lines');
  assert.equal(payload.projectSettings.mapboxAccessToken, 'pk.test-public-token-value');
  assert.equal(payload.lineTypes[0].name, 'default');
  assert.deepEqual(payload.reportConfig.rank.sort, [
    { metricKey: 'population', direction: 'desc' },
    { metricKey: 'area', direction: 'asc' },
  ]);
  assert.equal(payload.securitySettings.maxFailedAttempts, 5);

  const json = JSON.stringify(payload);
  assert.doesNotMatch(json, /passwordHash|PASSWORD_HASH|adminUsers|auditLog/i);
});

test('settings import rejects another transfer kind before opening a database transaction', async () => {
  let connected = false;
  const service = createProjectSettingsTransferRuntime({
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
  const service = createProjectSettingsTransferRuntime({
    async connect() {
      connected = true;
      throw new Error('must not connect');
    },
  });

  await assert.rejects(
    service.importSettings({
      _dtpstat: { kind: 'project-settings', schemaVersion: 9 },
    }),
    (error) => error instanceof ProjectSettingsTransferValidationError && /schemaVersion/.test(error.message),
  );
  assert.equal(connected, false);
});

function exportServiceWithSnapshot(snapshot, queries) {
  const client = {
    async query(text) {
      queries.push(text.trim());
      return { rows: [] };
    },
    release() {},
  };

  return createProjectSettingsTransferRuntime(
    {
      async connect() {
        return client;
      },
    },
    {
      repository: {
        async exportSnapshot() {
          return snapshot;
        },
      },
      acquireLock: async () => {},
    },
  );
}

test('settings export treats a missing report row as incomplete project settings before commit', async () => {
  const queries = [];
  const service = exportServiceWithSnapshot(
    {
      projectSettings: { projectName: 'Test' },
      lineTypes: [],
      reportConfigPresent: false,
      reportConfig: undefined,
      securitySettings: { maxFailedAttempts: 5 },
    },
    queries,
  );

  await assert.rejects(
    service.exportSettings(),
    /Project settings are incomplete; run database migrations/u,
  );

  assert.equal(
    queries.some((query) => /^COMMIT$/iu.test(query)),
    false,
  );
  assert.equal(
    queries.at(-1),
    'ROLLBACK',
  );
});

test('settings export validates a present null report config after committing the read snapshot', async () => {
  const queries = [];
  const service = exportServiceWithSnapshot(
    {
      projectSettings: { projectName: 'Test' },
      lineTypes: [],
      reportConfigPresent: true,
      reportConfig: null,
      securitySettings: { maxFailedAttempts: 5 },
    },
    queries,
  );

  await assert.rejects(
    service.exportSettings(),
    /Report configuration is incomplete; run database migrations/u,
  );

  const commitIndex = queries.findIndex(
    (query) => /^COMMIT$/iu.test(query),
  );
  const rollbackIndex = queries.findIndex(
    (query) => /^ROLLBACK$/iu.test(query),
  );

  assert.ok(commitIndex > 0);
  assert.ok(rollbackIndex > commitIndex);
});
