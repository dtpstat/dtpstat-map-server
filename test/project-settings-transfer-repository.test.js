import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createProjectSettingsTransferRepository,
} from '../src/db/project-settings-transfer-repository.js';

function createClient() {
  const queries = [];
  return {
    queries,
    async query(text, values = []) {
      const normalized = text.trim();
      queries.push({ text: normalized, values });

      if (normalized.includes('FROM project_settings')) {
        return { rows: [{ projectName: 'Test' }], rowCount: 1 };
      }
      if (normalized.includes('FROM geometry_history_speeds')) {
        return {
          rows: [{
            name: '1x',
            stepUnit: 'month',
            intervalSeconds: 1,
            isActive: true,
            isDefault: true,
          }],
          rowCount: 1,
        };
      }
      if (
        normalized.startsWith('SELECT code::integer AS code') &&
        normalized.includes('FROM line_types')
      ) {
        return { rows: [{ code: 0, name: 'default' }], rowCount: 1 };
      }
      if (normalized.includes('FROM report_config')) {
        return { rows: [{ config: { metrics: [], table_columns: [], csv_columns: [], rank: {} } }], rowCount: 1 };
      }
      if (normalized.includes('FROM admin_security_settings')) {
        return { rows: [{ maxFailedAttempts: 5 }], rowCount: 1 };
      }
      if (normalized === 'SELECT name FROM line_types ORDER BY id') {
        return { rows: [{ name: 'default' }], rowCount: 1 };
      }
      if (normalized.startsWith('INSERT INTO city_report_values')) {
        return { rows: [{ city_id: 1 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

test('project settings transfer repository exports one consistent snapshot', async () => {
  const repository = createProjectSettingsTransferRepository();
  const client = createClient();
  const snapshot = await repository.exportSnapshot(client);

  assert.equal(snapshot.projectSettings.projectName, 'Test');
  assert.equal(snapshot.historySpeeds, undefined);
  assert.equal(snapshot.projectSettings.historySpeeds[0].name, '1x');
  assert.equal(snapshot.lineTypes[0].name, 'default');
  assert.equal(snapshot.securitySettings.maxFailedAttempts, 5);
  assert.equal(client.queries.length, 5);
});

test('project settings transfer repository never overlaps queries on one client', async () => {
  const repository = createProjectSettingsTransferRepository();

  let active = false;
  const sequence = [];

  const client = {
    async query(text) {
      assert.equal(
        active,
        false,
        'query started before the previous query completed',
      );

      active = true;

      try {
        await new Promise(
          (resolve) =>
            setImmediate(resolve),
        );

        const normalized =
          text.trim();

        sequence.push(
          normalized,
        );

        if (
          normalized.includes(
            'FROM project_settings',
          )
        ) {
          return {
            rows: [
              {
                projectName:
                  'Test',
              },
            ],
            rowCount: 1,
          };
        }

        if (
          normalized.includes(
            'FROM geometry_history_speeds',
          )
        ) {
          return {
            rows: [],
            rowCount: 0,
          };
        }

        if (
          normalized.includes(
            'FROM line_types',
          )
        ) {
          return {
            rows: [],
            rowCount: 0,
          };
        }

        if (
          normalized.includes(
            'FROM report_config',
          )
        ) {
          return {
            rows: [
              {
                config: {},
              },
            ],
            rowCount: 1,
          };
        }

        if (
          normalized.includes(
            'FROM admin_security_settings',
          )
        ) {
          return {
            rows: [
              {
                maxFailedAttempts: 5,
              },
            ],
            rowCount: 1,
          };
        }

        throw new Error(
          `Unexpected SQL: ${normalized}`,
        );
      } finally {
        active = false;
      }
    },
  };

  await repository
    .exportSnapshot(client);

  assert.equal(
    sequence.length,
    5,
  );
  assert.match(
    sequence[0],
    /FROM project_settings/u,
  );
  assert.match(
    sequence[1],
    /FROM geometry_history_speeds/u,
  );
  assert.match(
    sequence[2],
    /FROM line_types/u,
  );
  assert.match(
    sequence[3],
    /FROM report_config/u,
  );
  assert.match(
    sequence[4],
    /FROM admin_security_settings/u,
  );
});

test('project settings transfer repository owns line-type staging and settings SQL', async () => {
  const repository = createProjectSettingsTransferRepository();
  const client = createClient();

  await repository.replaceLineTypes(client, [{
    name: 'default',
    title: 'Lines',
    color: '#045b69',
    style: 'solid',
    width: 4,
  }]);
  const names = await repository.currentLineTypeNames(client);
  await repository.updateProjectSettings(client, {
    projectName: 'Test',
    keywords: [],
    footerHtml: '',
    yandexMetrikaId: null,
    googleAnalyticsId: null,
    themePreset: 'modern',
    showLineLabels: false,
    showLinePopups: true,
    showPointGeometries: true,
    showLineGeometries: false,
    showPolygonGeometries: true,
    showGeometryTimeline: true,
    historyStartDate: '2000-01-01',
    historySpeeds: null,
    hasPublicDownloadName: false,
    publicDownloadName: null,
    hasMapboxAccessToken: false,
    mapboxAccessToken: null,
    largeCityPopulationThreshold: 400000,
    largeCityAreaKm2Threshold: null,
  });

  assert.deepEqual(names, ['default']);
  assert.match(
    client.queries[0].text,
    /^CREATE TEMP TABLE project_settings_line_types_stage/u,
  );
  assert.match(
    client.queries[1].text,
    /^INSERT INTO project_settings_line_types_stage/u,
  );
  assert.match(
    client.queries.at(-1).text,
    /^UPDATE project_settings SET/u,
  );
  assert.deepEqual(
    client.queries.at(-1).values.slice(-5),
    [true, false, true, true, '2000-01-01'],
  );
  assert.match(
    client.queries.at(-1).text,
    /show_point_geometries=\$15::boolean/u,
  );
  assert.match(
    client.queries.at(-1).text,
    /show_geometry_timeline=\$18::boolean/u,
  );
  assert.match(
    client.queries.at(-1).text,
    /history_start_date=\$19::date/u,
  );
});


test('project settings transfer repository preserves report row presence separately from config value', async () => {
  const repository = createProjectSettingsTransferRepository();

  const withNullConfig = {
    async query(text) {
      const normalized = text.trim();
      if (normalized.includes('FROM project_settings')) {
        return { rows: [{ projectName: 'Test' }], rowCount: 1 };
      }
      if (normalized.includes('FROM geometry_history_speeds')) {
        return { rows: [], rowCount: 0 };
      }
      if (normalized.includes('FROM line_types')) {
        return { rows: [], rowCount: 0 };
      }
      if (normalized.includes('FROM report_config')) {
        return { rows: [{ config: null }], rowCount: 1 };
      }
      if (normalized.includes('FROM admin_security_settings')) {
        return { rows: [{ maxFailedAttempts: 5 }], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${normalized}`);
    },
  };

  const present = await repository.exportSnapshot(withNullConfig);
  assert.equal(present.reportConfigPresent, true);
  assert.equal(present.reportConfig, null);

  const withoutReportRow = {
    async query(text) {
      const normalized = text.trim();
      if (normalized.includes('FROM project_settings')) {
        return { rows: [{ projectName: 'Test' }], rowCount: 1 };
      }
      if (normalized.includes('FROM geometry_history_speeds')) {
        return { rows: [], rowCount: 0 };
      }
      if (normalized.includes('FROM line_types')) {
        return { rows: [], rowCount: 0 };
      }
      if (normalized.includes('FROM report_config')) {
        return { rows: [], rowCount: 0 };
      }
      if (normalized.includes('FROM admin_security_settings')) {
        return { rows: [{ maxFailedAttempts: 5 }], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${normalized}`);
    },
  };

  const missing = await repository.exportSnapshot(withoutReportRow);
  assert.equal(missing.reportConfigPresent, false);
  assert.equal(missing.reportConfig, undefined);
});


test('project settings transfer repository includes request rate limits in security SQL', async () => {
  const fs =
    await import(
      'node:fs/promises'
    );
  const source =
    await fs.readFile(
      new URL(
        '../src/db/project-settings-transfer-repository.js',
        import.meta.url,
      ),
      'utf8',
    );

  assert.match(
    source,
    /request_rate_limit_user_per_minute AS "requestRateLimitUserPerMinute"/u,
  );
  assert.match(
    source,
    /request_rate_limit_global_per_minute AS "requestRateLimitGlobalPerMinute"/u,
  );
  assert.match(
    source,
    /request_rate_limit_user_per_minute=\$10/u,
  );
  assert.match(
    source,
    /request_rate_limit_global_per_minute=\$11/u,
  );
});
