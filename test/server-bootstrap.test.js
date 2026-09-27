import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bootstrapServerApplication,
  prepareServerDatabase,
} from '../src/application/server-bootstrap.js';

test('database startup applies and verifies migrations before repository use', async () => {
  const operations = [];
  const calls = [];
  const logs = [];
  const config = {
    projectRoot: '/srv/app',
    database: {
      schema: 'buslanes',
    },
  };
  const pool = {
    marker: 'pool',
  };

  await prepareServerDatabase({
    config,
    pool,
    async migrate(
      receivedPool,
      options,
    ) {
      assert.equal(
        receivedPool,
        pool,
      );
      assert.equal(
        options.projectRoot,
        '/srv/app',
      );
      assert.equal(
        options.schema,
        'buslanes',
      );

      calls.push('migrate');
      options.logger({
        status:
          'already-applied',
        migration: {
          version: 1,
          fileName:
            'V001__base.sql',
        },
      });
      options.logger({
        status: 'applied',
        migration: {
          version: 2,
          fileName:
            'V002__next.sql',
        },
      });

      return {
        version: 2,
        appliedCount: 1,
        totalCount: 2,
      };
    },
    async verifyMigrations(
      receivedPool,
      options,
    ) {
      assert.equal(
        receivedPool,
        pool,
      );
      assert.deepEqual(
        options,
        {
          projectRoot:
            '/srv/app',
          schema: 'buslanes',
        },
      );
      calls.push('verify');
      return {
        currentVersion: 2,
      };
    },
    async runOperation(
      event,
      operation,
    ) {
      operations.push(event);
      return operation();
    },
    log(
      level,
      event,
      details,
    ) {
      logs.push({
        level,
        event,
        details,
      });
    },
  });

  assert.deepEqual(
    operations,
    [
      'database.migrations.apply',
      'database.migrations.verify',
    ],
  );
  assert.deepEqual(
    calls,
    [
      'migrate',
      'verify',
    ],
  );
  assert.deepEqual(
    logs,
    [
      {
        level: 'info',
        event:
          'database.migration:applied',
        details: {
          version: 2,
          fileName:
            'V002__next.sql',
        },
      },
    ],
  );
});

test('application bootstrap preserves startup order and returns admin success state', async () => {
  const operations = [];
  const calls = [];
  const config = {
    database: {
      schema: 'buslanes',
    },
    importApi: {
      streamUploadDirectory:
        '/srv/app/var/import-staging',
      bootstrapUsername:
        'admin',
      bootstrapPassword:
        'secret',
    },
    osmCityUpdate: {
      endpoint:
        'https://example.test',
    },
    publicMap: {
      bootstrapAccessToken:
        'mapbox-token',
    },
  };
  const updates = [
    {
      taskType: 'kml-update',
      completedAt:
        '2026-09-24T12:00:00Z',
    },
  ];

  const result =
    await bootstrapServerApplication({
      config,
      repository: {
        async health() {
          calls.push('health');
        },
      },
      osmImportSettingsRepository: {
        async bootstrap(options) {
          assert.equal(
            options,
            config.osmCityUpdate,
          );
          calls.push(
            'osm-bootstrap',
          );
          return {
            initialized: true,
          };
        },
      },
      securityService: {
        async bootstrap(
          credentials,
        ) {
          assert.deepEqual(
            credentials,
            {
              username: 'admin',
              password: 'secret',
            },
          );
          calls.push(
            'security-bootstrap',
          );
          return {
            created: false,
          };
        },
      },
      projectSettingsRepository: {
        async bootstrapMapboxAccessToken(
          token,
        ) {
          assert.equal(
            token,
            'mapbox-token',
          );
          calls.push(
            'mapbox-bootstrap',
          );
          return {
            initialized: true,
            configured: true,
          };
        },
        async get() {
          calls.push(
            'settings-load',
          );
          return {
            projectName:
              'DTP Stat',
          };
        },
      },
      adminTaskSuccessRepository: {
        async list() {
          calls.push(
            'success-state',
          );
          return updates;
        },
      },
      derivedState: {
        async refreshAll(details) {
          assert.deepEqual(
            details,
            {
              reason: 'startup',
            },
          );
          calls.push(
            'derived-refresh',
          );
        },
      },
      async cleanupUploads(
        directory,
      ) {
        assert.equal(
          directory,
          '/srv/app/var/import-staging',
        );
        calls.push(
          'spool-cleanup',
        );
        return 3;
      },
      async runOperation(
        event,
        operation,
      ) {
        operations.push(event);
        return operation();
      },
    });

  assert.deepEqual(
    operations,
    [
      'database.health',
      'portable-import-spool.cleanup',
      'osm-import-settings.bootstrap',
      'admin-security.bootstrap',
      'project-settings.mapbox.bootstrap',
      'project-settings.load',
      'admin-success-state.load',
    ],
  );
  assert.deepEqual(
    calls,
    [
      'health',
      'spool-cleanup',
      'osm-bootstrap',
      'security-bootstrap',
      'mapbox-bootstrap',
      'settings-load',
      'derived-refresh',
      'success-state',
    ],
  );
  assert.deepEqual(
    result,
    {
      initialSuccessfulUpdates:
        updates,
    },
  );
});
