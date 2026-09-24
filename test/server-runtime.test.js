import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createServerRuntime,
} from '../src/application/server-runtime.js';

test('server runtime composes repository service auth and derived-state slices', () => {
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
    'createProjectSettingsTransferService',
    'createReportConfigService',
    'createDataExportRepository',
    'createPublicDownloadRepository',
    'createDataImportService',
    'createCityBoundaryTransferService',
    'createPopulationImportService',
    'createOsmImportSettingsRepository',
    'createOsmBoundaryAdminRepository',
    'createOsmCityCheckpointRepository',
    'createAdminTaskSuccessRepository',
    'createAdminSecurityRepository',
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

  factories.createProjectSettingsRepository =
    (
      receivedPool,
      publicMap,
    ) => {
      assert.equal(
        receivedPool,
        pool,
      );
      assert.equal(
        publicMap,
        config.publicMap,
      );
      calls.push(
        'createProjectSettingsRepository',
      );
      return value(
        'createProjectSettingsRepository',
      );
    };

  factories.createKmlUpdateService =
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
        'createKmlUpdateService',
      );
      return value(
        'createKmlUpdateService',
      );
    };

  factories.createOsmCityUpdateService =
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
        'createOsmCityUpdateService',
      );
      return value(
        'createOsmCityUpdateService',
      );
    };

  factories.createPublicDownloadService =
    (options) => {
      assert.equal(
        options
          .repository
          .name,
        'createPublicDownloadRepository',
      );
      assert.equal(
        options
          .projectSettingsRepository
          .name,
        'createProjectSettingsRepository',
      );
      assert.equal(
        options.directory,
        '/srv/app/var/public-downloads',
      );
      calls.push(
        'createPublicDownloadService',
      );
      return {
        name:
          'createPublicDownloadService',
        directory:
          options.directory,
      };
    };

  factories.createAdminSecurityService =
    (repository) => {
      assert.equal(
        repository.name,
        'createAdminSecurityRepository',
      );
      calls.push(
        'createAdminSecurityService',
      );
      return value(
        'createAdminSecurityService',
      );
    };

  factories.createAdminAuthorization =
    (securityService) => {
      assert.equal(
        securityService.name,
        'createAdminSecurityService',
      );
      calls.push(
        'createAdminAuthorization',
      );
      return value(
        'createAdminAuthorization',
      );
    };

  const refreshCalls = [];
  factories.createDerivedStateRefresh =
    (dependencies) => {
      assert.equal(
        dependencies
          .publicDownloadService
          .name,
        'createPublicDownloadService',
      );
      assert.equal(
        dependencies
          .reportConfigService
          .name,
        'createReportConfigService',
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
      'createProjectSettingsRepository',
      'createProjectSettingsTransferService',
      'createReportConfigService',
      'createDataExportRepository',
      'createPublicDownloadRepository',
      'createPublicDownloadService',
      'createDataImportService',
      'createCityBoundaryTransferService',
      'createPopulationImportService',
      'createKmlUpdateService',
      'createOsmImportSettingsRepository',
      'createOsmBoundaryAdminRepository',
      'createOsmCityCheckpointRepository',
      'createOsmCityUpdateService',
      'createAdminTaskSuccessRepository',
      'createAdminSecurityRepository',
      'createAdminSecurityService',
      'createAdminAuthorization',
      'createDerivedStateRefresh',
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
      .adminTaskSuccessRepository,
  );
  assert.equal(
    runtime
      .bootstrapDependencies
      .securityService,
    runtime.securityService,
  );
  assert.equal(
    runtime
      .bootstrapDependencies
      .derivedState,
    runtime.derivedState,
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
    runtime.adminAuth,
  );
  assert.equal(
    runtime
      .appDependencies
      .securityService,
    runtime.securityService,
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
