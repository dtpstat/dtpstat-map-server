import path from 'node:path';
import {
  createPublicDownloadService,
} from './public-downloads/service.js';
import {
  createDerivedStateRefresh,
} from './derived-state-refresh.js';
import {
  createAdminSecurityRepository,
} from '../db/admin-security-repository.js';
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
  createDataExportRepository,
} from '../db/data-export-repository.js';
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
  createOsmCityCheckpointRepository,
} from '../db/osm-city-checkpoint-repository.js';
import {
  createOsmCityUpdateRuntime,
} from './osm-update-runtime.js';
import {
  createOsmImportSettingsRepository,
} from '../db/osm-import-settings-repository.js';
import {
  createProjectSettingsRepository,
} from '../db/project-settings-repository.js';
import {
  createProjectSettingsTransferRuntime,
  createReportConfigRuntime,
} from './project-report-runtime.js';
import {
  createPublicDownloadRepository,
} from '../db/public-download-repository.js';
import {
  createAdminAuthorization,
} from '../http/admin-auth.js';
import {
  createAdminSecurityService,
} from '../modules/security/service.js';

const DEFAULT_FACTORIES =
  Object.freeze({
    createAdminAuthorization,
    createAdminSecurityRepository,
    createAdminSecurityService,
    createAdminTaskSuccessRepository,
    createCitiesRepository,
    createCityBoundaryTransferRuntime,
    createDataExportRepository,
    createLineImportRuntime,
    createDerivedStateRefresh,
    createKmlUpdateRuntime,
    createLineTypesRepository,
    createOsmBoundaryAdminRepository,
    createOsmCityCheckpointRepository,
    createOsmCityUpdateRuntime,
    createOsmImportSettingsRepository,
    createPopulationImportRuntime,
    createProjectSettingsRepository,
    createProjectSettingsTransferRuntime,
    createPublicDownloadRepository,
    createPublicDownloadService,
    createReportConfigRuntime,
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
  const projectSettingsRepository =
    runtimeFactories
      .createProjectSettingsRepository(
        pool,
        config.publicMap,
      );
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
      .createDataExportRepository(pool);
  const publicDownloadRepository =
    runtimeFactories
      .createPublicDownloadRepository(
        pool,
      );
  const publicDownloadService =
    runtimeFactories
      .createPublicDownloadService({
        repository:
          publicDownloadRepository,
        projectSettingsRepository,
        directory:
          path.join(
            config.projectRoot,
            'var',
            'public-downloads',
          ),
      });
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
      .createOsmCityCheckpointRepository(
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
  const adminSecurityRepository =
    runtimeFactories
      .createAdminSecurityRepository(
        pool,
      );
  const securityService =
    runtimeFactories
      .createAdminSecurityService(
        adminSecurityRepository,
      );
  const adminAuth =
    runtimeFactories
      .createAdminAuthorization(
        securityService,
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
