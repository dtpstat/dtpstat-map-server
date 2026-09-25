import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createServerRuntime,
} from '../src/application/server-runtime.js';

test('server runtime exposes explicit bootstrap app and admin dependency slices', () => {
  const calls = [];
  const pool = {
    name: 'pool',
  };
  const config = {
    projectRoot: '/srv/app',
    publicMap: {
      marker: 'public-map',
    },
    kmlUpdate: {
      marker: 'kml',
    },
    osmCityUpdate: {
      marker: 'osm',
    },
  };

  const value =
    (name) => ({
      name,
    });
  const factories = {};
  const simpleFactories = [
    'createCitiesRepository',
    'createLineTypesRepository',
    'createProjectSettingsTransferRuntime',
    'createReportConfigRuntime',
    'createDataExportRuntime',
    'createLineImportRuntime',
    'createCityBoundaryTransferRuntime',
    'createPopulationImportRuntime',
    'createOsmImportSettingsRepository',
    'createOsmBoundaryAdminRepository',
    'createOsmCityCheckpointRepository',
    'createAdminTaskSuccessRepository',
  ];

  for (const name of simpleFactories) {
    factories[name] =
      (receivedPool) => {
        assert.equal(
          receivedPool,
          pool,
          name,
        );
        calls.push(name);
        return value(name);
      };
  }

  factories.createProjectRuntime =
    (options) => {
      assert.equal(
        options.database,
        pool,
      );
      assert.equal(
        options.publicMapDefaults,
        config.publicMap,
      );
      assert.equal(
        options.projectRoot,
        config.projectRoot,
      );
      calls.push(
        'createProjectRuntime',
      );
      return {
        projectSettingsRepository:
          value(
            'createProjectSettingsRuntime',
          ),
        publicDownloadService: {
          name:
            'createPublicDownloadRuntime',
          directory:
            '/srv/app/var/public-downloads',
        },
      };
    };

  factories.createKmlUpdateRuntime =
    (
      receivedPool,
      options,
    ) => {
      assert.equal(
        receivedPool,
        pool,
      );
      assert.equal(
        options,
        config.kmlUpdate,
      );
      calls.push(
        'createKmlUpdateRuntime',
      );
      return value(
        'createKmlUpdateRuntime',
      );
    };

  factories.createOsmCityUpdateRuntime =
    (
      receivedPool,
      options,
      dependencies,
    ) => {
      assert.equal(
        receivedPool,
        pool,
      );
      assert.equal(
        options,
        config.osmCityUpdate,
      );
      assert.equal(
        dependencies
          .settingsRepository
          .name,
        'createOsmImportSettingsRepository',
      );
      assert.equal(
        dependencies
          .checkpointRepository
          .name,
        'createOsmCityCheckpointRepository',
      );
      calls.push(
        'createOsmCityUpdateRuntime',
      );
      return value(
        'createOsmCityUpdateRuntime',
      );
    };

  factories.createSecurityRuntime =
    (receivedPool) => {
      assert.equal(
        receivedPool,
        pool,
      );
      calls.push(
        'createSecurityRuntime',
      );
      return {
        securityService:
          value(
            'createAdminSecurityService',
          ),
        adminAuth:
          value(
            'createAdminAuthorization',
          ),
      };
    };

  const refreshCalls = [];
  factories.createDerivedStateRefresh =
    (dependencies) => {
      assert.equal(
        dependencies
          .publicDownloadService
          .name,
        'createPublicDownloadRuntime',
      );
      assert.equal(
        dependencies
          .reportConfigService
          .name,
        'createReportConfigRuntime',
      );
      calls.push(
        'createDerivedStateRefresh',
      );
      return {
        async refreshPublicDownloads(
          details,
        ) {
          refreshCalls.push({
            kind: 'public',
            details,
          });
        },
        async refreshAll(details) {
          refreshCalls.push({
            kind: 'all',
            details,
          });
        },
      };
    };

  const runtime =
    createServerRuntime({
      pool,
      config,
      factories,
    });

  assert.deepEqual(
    calls,
    [
      'createCitiesRepository',
      'createLineTypesRepository',
      'createProjectRuntime',
      'createProjectSettingsTransferRuntime',
      'createReportConfigRuntime',
      'createDataExportRuntime',
      'createLineImportRuntime',
      'createCityBoundaryTransferRuntime',
      'createPopulationImportRuntime',
      'createKmlUpdateRuntime',
      'createOsmImportSettingsRepository',
      'createOsmBoundaryAdminRepository',
      'createOsmCityCheckpointRepository',
      'createOsmCityUpdateRuntime',
      'createAdminTaskSuccessRepository',
      'createSecurityRuntime',
      'createDerivedStateRefresh',
    ],
  );

  assert.deepEqual(
    Object.keys(runtime).sort(),
    [
      'adminRuntimeDependencies',
      'appDependencies',
      'bootstrapDependencies',
    ],
  );

  assert.deepEqual(
    Object.keys(
      runtime
        .adminRuntimeDependencies,
    ).sort(),
    [
      'adminAuth',
      'adminTaskSuccessRepository',
      'derivedState',
      'securityService',
    ],
  );

  assert.equal(
    runtime
      .bootstrapDependencies
      .config,
    config,
  );
  assert.equal(
    runtime
      .bootstrapDependencies
      .repository
      .name,
    'createCitiesRepository',
  );
  assert.equal(
    runtime
      .bootstrapDependencies
      .adminTaskSuccessRepository,
    runtime
      .adminRuntimeDependencies
      .adminTaskSuccessRepository,
  );
  assert.equal(
    runtime
      .bootstrapDependencies
      .securityService,
    runtime
      .adminRuntimeDependencies
      .securityService,
  );
  assert.equal(
    runtime
      .bootstrapDependencies
      .derivedState,
    runtime
      .adminRuntimeDependencies
      .derivedState,
  );

  assert.equal(
    runtime
      .appDependencies
      .repository,
    runtime
      .bootstrapDependencies
      .repository,
  );
  assert.equal(
    runtime
      .appDependencies
      .adminAuth,
    runtime
      .adminRuntimeDependencies
      .adminAuth,
  );
  assert.equal(
    runtime
      .appDependencies
      .securityService,
    runtime
      .adminRuntimeDependencies
      .securityService,
  );
  assert.equal(
    runtime
      .appDependencies
      .config,
    config,
  );

  return Promise.all([
    runtime
      .appDependencies
      .refreshPublicDownloads(),
    runtime
      .appDependencies
      .refreshPublicDownloadsAfterSettingsImport(),
    runtime
      .appDependencies
      .refreshProjectDerived(),
    runtime
      .appDependencies
      .refreshOsmBoundaryDerived(),
  ]).then(() => {
    assert.deepEqual(
      refreshCalls,
      [
        {
          kind: 'public',
          details: {
            reason:
              'report-config',
          },
        },
        {
          kind: 'public',
          details: {
            reason:
              'project-settings-import',
          },
        },
        {
          kind: 'all',
          details: {
            reason:
              'project-settings',
          },
        },
        {
          kind: 'all',
          details: {
            reason:
              'osm-boundary-settings',
          },
        },
      ],
    );
  });
});
