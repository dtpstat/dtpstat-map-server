import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import {
  DEFAULT_REPORT_CONFIG,
  validateReportConfig,
} from '../src/data/report-config.js';
import { createReportConfigRouter } from '../src/routes/report-config-api.js';

const authorization = `Basic ${Buffer.from('admin:test-secret').toString('base64')}`;

async function withServer(callback, options = {}) {
  let config = structuredClone(DEFAULT_REPORT_CONFIG);
  let afterSaveCalls = 0;
  const reportConfigService = options.reportConfigService ?? {
    async get() {
      return structuredClone(config);
    },
    async save(payload) {
      config = {
        ...validateReportConfig(payload, {
          allowedLineTypeNames: ['Обособленные', 'Совмещённые'],
        }),
        updatedAt: '2026-09-06T02:00:00.000Z',
      };
      return {
        config: structuredClone(config),
        materialized: {
          cities: 12,
          metrics: config.metrics.length,
          rankSort: config.rank.sort,
          rankMetricKey: config.rank.metricKey,
          rankDirection: config.rank.direction,
        },
      };
    },
  };
  const adminTasks = options.adminTasks ?? { active: () => null };
  const app = express();
  app.use('/api', createReportConfigRouter({
    reportConfigService,
    lineTypesRepository: {
      async list() {
        return [
          { code: 1, name: 'Обособленные', title: 'Обособленные пути' },
          { code: 2, name: 'Совмещённые', title: 'Совмещённые пути' },
        ];
      },
    },
    adminTasks,
    importApi: {
      username: 'admin',
      password: 'test-secret',
      maxBodyBytes: 1024 * 1024,
    },
    afterSave: async () => {
      afterSaveCalls += 1;
      return { csvBytes: 123, cityCount: 12 };
    },
  }));
  app.use((error, _request, response, _next) => {
    response.status(500).json({ error: error.message });
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    await callback(`http://127.0.0.1:${address.port}`, {
      afterSaveCalls: () => afterSaveCalls,
    });
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test('public report endpoint exposes only display configuration', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/report-config`);
    assert.equal(response.status, 200);
    const payload = await response.json();

    assert.deepEqual(payload.tableColumns, DEFAULT_REPORT_CONFIG.tableColumns);
    assert.deepEqual(payload.rank, DEFAULT_REPORT_CONFIG.rank);
    assert.equal('metrics' in payload, false);
    assert.equal('csvColumns' in payload, false);
  });
});

test('admin report endpoint requires auth and returns fixed catalogs', async () => {
  await withServer(async (baseUrl) => {
    const unauthorized = await fetch(`${baseUrl}/api/admin/report-config`);
    assert.equal(unauthorized.status, 401);

    const response = await fetch(`${baseUrl}/api/admin/report-config`, {
      headers: { Authorization: authorization },
    });
    assert.equal(response.status, 200);
    const payload = await response.json();

    assert.equal(payload.config.metrics.length, 3);
    assert.ok(payload.catalog.fields.some((field) => field.key === 'geometry.length_m'));
    assert.ok(payload.catalog.fields.some((field) => field.key === 'city.area_m2'));
    assert.ok(payload.catalog.aggregates.some((aggregate) => aggregate.key === 'sum'));
    assert.ok(payload.catalog.aggregates.some((aggregate) => aggregate.key === 'median'));
    assert.ok(payload.catalog.operators.some((operator) => operator.key === 'divide'));
    assert.ok(payload.catalog.operandKinds.some((kind) => kind.key === 'metric'));
    assert.deepEqual(
      payload.catalog.precedenceLevels.map((level) => level.value),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    );
    assert.deepEqual(
      payload.catalog.formatFontSizes.map((item) => item.value),
      [-2, -1, 0, 1, 2],
    );
    assert.equal(payload.catalog.maxFormatRules, 8);
    assert.equal(payload.catalog.maxRankSorts, 8);
    assert.deepEqual(payload.lineTypes.map((item) => item.name), [
      'Обособленные',
      'Совмещённые',
    ]);
  });
});

test('saving report materializes values, sequential ranking and public snapshots', async () => {
  await withServer(async (baseUrl, state) => {
    const config = structuredClone(DEFAULT_REPORT_CONFIG);
    config.tableColumns[2].title = 'длина сети (км)';
    config.tableColumns[2].formatRules = [{
      min: 10,
      max: null,
      bold: true,
      italic: false,
      underline: false,
      strike: false,
      color: '#112233',
      fontSizeStep: 1,
    }];
    config.rank = {
      sort: [
        { metricKey: 'lane_m_per_1000', direction: 'desc' },
        { metricKey: 'lane_length_m', direction: 'desc' },
        { metricKey: 'population', direction: 'asc' },
      ],
    };

    const response = await fetch(`${baseUrl}/api/admin/report-config`, {
      method: 'PUT',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(config),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();

    assert.equal(payload.config.tableColumns[2].title, 'длина сети (км)');
    assert.equal(payload.config.tableColumns[2].formatRules[0].color, '#112233');
    assert.deepEqual(payload.config.rank.sort, config.rank.sort);
    assert.deepEqual(payload.materialized.rankSort, config.rank.sort);
    assert.equal(payload.materialized.cities, 12);
    assert.equal(payload.snapshots.csvBytes, 123);
    assert.equal(state.afterSaveCalls(), 1);
  });
});

test('saving report rejects arbitrary technical field names', async () => {
  await withServer(async (baseUrl, state) => {
    const config = structuredClone(DEFAULT_REPORT_CONFIG);
    config.metrics[0].source.field = 'cities.population); DROP TABLE cities; --';

    const response = await fetch(`${baseUrl}/api/admin/report-config`, {
      method: 'PUT',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(config),
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /not allowed/);
    assert.equal(state.afterSaveCalls(), 0);
  });
});

test('saving report is blocked while another admin task is active', async () => {
  await withServer(async (baseUrl, state) => {
    const response = await fetch(`${baseUrl}/api/admin/report-config`, {
      method: 'PUT',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(DEFAULT_REPORT_CONFIG),
    });
    assert.equal(response.status, 409);
    const payload = await response.json();
    assert.equal(payload.taskId, 'active-task');
    assert.equal(state.afterSaveCalls(), 0);
  }, {
    adminTasks: {
      active: () => ({ id: 'active-task', type: 'kml-update', status: 'running' }),
    },
  });
});
