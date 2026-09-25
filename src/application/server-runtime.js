import {
  createDerivedStateRefresh,
} from './derived-state-refresh.js';
import {
  createAdminTaskSuccessRepository,
} from '../db/admin-task-success-repository.js';
import {
  createCitiesRepository,
} from '../db/cities-repository.js';
import {
  createCityBoundaryTransferRuntime,
  createPopulationImportRuntime,
} from './portable-ingestion-runtime.js';
import {
  createDataExportRuntime,
} from './data-transfer/export-runtime.js';
import {
  createKmlUpdateRuntime,
  createLineImportRuntime,
} from './lines-ingestion-runtime.js';
import {
  createLineTypesRepository,
} from '../db/line-types-repository.js';
import {
  createOsmBoundaryAdminRepository,
} from '../db/osm-boundary-admin-repository.js';
import {
  createOsmCheckpointRuntime,
} from './osm-checkpoint-runtime.js';
import {
  createOsmCityUpdateRuntime,
} from './osm-update-runtime.js';
import {
  createOsmImportSettingsRepository,
} from '../db/osm-import-settings-repository.js';
import {
  createProjectRuntime,
} from './project-runtime.js';
import {
  createProjectSettingsTransferRuntime,
  createReportConfigRuntime,
} from './project-report-runtime.js';
import {
  createSecurityRuntime,
} from './security-runtime.js';

const DEFAULT_FACTORIES =
  Object.freeze({
    createAdminTaskSuccessRepository,
    createCitiesRepository,
    createCityBoundaryTransferRuntime,
    createDataExportRuntime,
    createLineImportRuntime,
    createDerivedStateRefresh,
    createKmlUpdateRuntime,
    createLineTypesRepository,
    createOsmBoundaryAdminRepository,
    createOsmCheckpointRuntime,
    createOsmCityUpdateRuntime,
    createOsmImportSettingsRepository,
    createPopulationImportRuntime,
    createProjectRuntime,
    createProjectSettingsTransferRuntime,
    createReportConfigRuntime,
    createSecurityRuntime,
  });

/**
 * Construct the long-lived repository/service graph after migrations have
 * completed. The returned slices make startup/bootstrap and HTTP composition
 * explicit without making server.js aware of individual DB constructors or
 * leaking runtime internals outside their owning composition slice.
 *
 * @param {{
 *   pool: any,
 *   config: any,
 *   factories?: Partial<typeof DEFAULT_FACTORIES>
 * }} dependencies
 */
export function createServerRuntime({
  pool,
  config,
  factories = {},
}) {
  const runtimeFactories = {
    ...DEFAULT_FACTORIES,
    ...factories,
  };

  const repository =
    runtimeFactories
      .createCitiesRepository(pool);
  const lineTypesRepository =
    runtimeFactories
      .createLineTypesRepository(pool);
  const {
    projectSettingsRepository,
    publicDownloadService,
  } =
    runtimeFactories
      .createProjectRuntime({
        database: pool,
        publicMapDefaults:
          config.publicMap,
        projectRoot:
          config.projectRoot,
      });
  const settingsTransferService =
    runtimeFactories
      .createProjectSettingsTransferRuntime(
        pool,
      );
  const reportConfigService =
    runtimeFactories
      .createReportConfigRuntime(pool);
  const exportRepository =
    runtimeFactories
      .createDataExportRuntime(pool);
  const importService =
    runtimeFactories
      .createLineImportRuntime(pool);
  const cityBoundaryTransferService =
    runtimeFactories
      .createCityBoundaryTransferRuntime(
        pool,
      );
  const populationService =
    runtimeFactories
      .createPopulationImportRuntime(
        pool,
      );
  const kmlUpdateService =
    runtimeFactories
      .createKmlUpdateRuntime(
        pool,
        config.kmlUpdate,
      );
  const osmImportSettingsRepository =
    runtimeFactories
      .createOsmImportSettingsRepository(
        pool,
      );
  const osmBoundaryAdminRepository =
    runtimeFactories
      .createOsmBoundaryAdminRepository(
        pool,
      );
  const osmCityCheckpointRepository =
    runtimeFactories
      .createOsmCheckpointRuntime(
        pool,
      );
  const osmCityUpdateService =
    runtimeFactories
      .createOsmCityUpdateRuntime(
        pool,
        config.osmCityUpdate,
        {
          settingsRepository:
            osmImportSettingsRepository,
          checkpointRepository:
            osmCityCheckpointRepository,
        },
      );
  const adminTaskSuccessRepository =
    runtimeFactories
      .createAdminTaskSuccessRepository(
        pool,
      );
  const {
    securityService,
    adminAuth,
  } =
    runtimeFactories
      .createSecurityRuntime(
        pool,
      );
  const derivedState =
    runtimeFactories
      .createDerivedStateRefresh({
        publicDownloadService,
        reportConfigService,
      });

  const bootstrapDependencies = {
    config,
    repository,
    osmImportSettingsRepository,
    securityService,
    projectSettingsRepository,
    adminTaskSuccessRepository,
    derivedState,
  };

  const appDependencies = {
    repository,
    lineTypesRepository,
    projectSettingsRepository,
    settingsTransferService,
    reportConfigService,
    refreshPublicDownloads:
      () =>
        derivedState
          .refreshPublicDownloads({
            reason:
              'report-config',
          }),
    refreshPublicDownloadsAfterSettingsImport:
      () =>
        derivedState
          .refreshPublicDownloads({
            reason:
              'project-settings-import',
          }),
    refreshProjectDerived:
      () =>
        derivedState
          .refreshAll({
            reason:
              'project-settings',
          }),
    refreshOsmBoundaryDerived:
      () =>
        derivedState
          .refreshAll({
            reason:
              'osm-boundary-settings',
          }),
    osmImportSettingsRepository,
    osmBoundaryAdminRepository,
    exportRepository,
    importService,
    cityBoundaryTransferService,
    populationService,
    kmlUpdateService,
    osmCityUpdateService,
    adminAuth,
    securityService,
    config,
  };

  const adminRuntimeDependencies = {
    adminTaskSuccessRepository,
    securityService,
    adminAuth,
    derivedState,
  };

  return {
    bootstrapDependencies,
    appDependencies,
    adminRuntimeDependencies,
  };
}
