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
  createCityBoundaryTransferService,
} from '../db/city-boundary-transfer-service.js';
import {
  createDataExportRepository,
} from '../db/data-export-repository.js';
import {
  createDataImportService,
} from '../db/data-import-service.js';
import {
  createKmlUpdateService,
} from '../db/kml-update-service.js';
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
  createOsmCityUpdateService,
} from '../db/osm-city-update-service.js';
import {
  createOsmImportSettingsRepository,
} from '../db/osm-import-settings-repository.js';
import {
  createPopulationImportService,
} from '../db/population-import-service.js';
import {
  createProjectSettingsRepository,
} from '../db/project-settings-repository.js';
import {
  createProjectSettingsTransferService,
} from '../db/project-settings-transfer-service.js';
import {
  createPublicDownloadRepository,
} from '../db/public-download-repository.js';
import {
  createReportConfigService,
} from '../db/report-config-service.js';
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
    createCityBoundaryTransferService,
    createDataExportRepository,
    createDataImportService,
    createDerivedStateRefresh,
    createKmlUpdateService,
    createLineTypesRepository,
    createOsmBoundaryAdminRepository,
    createOsmCityCheckpointRepository,
    createOsmCityUpdateService,
    createOsmImportSettingsRepository,
    createPopulationImportService,
    createProjectSettingsRepository,
    createProjectSettingsTransferService,
    createPublicDownloadRepository,
    createPublicDownloadService,
    createReportConfigService,
  });

/**
 * Construct the long-lived repository/service graph after migrations have
 * completed. The returned slices make startup/bootstrap and HTTP composition
 * explicit without making server.js aware of individual DB constructors.
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
      .createProjectSettingsTransferService(
        pool,
      );
  const reportConfigService =
    runtimeFactories
      .createReportConfigService(pool);
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
      .createDataImportService(pool);
  const cityBoundaryTransferService =
    runtimeFactories
      .createCityBoundaryTransferService(
        pool,
      );
  const populationService =
    runtimeFactories
      .createPopulationImportService(
        pool,
      );
  const kmlUpdateService =
    runtimeFactories
      .createKmlUpdateService(
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
      .createOsmCityUpdateService(
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

  return {
    bootstrapDependencies: {
      config,
      repository,
      osmImportSettingsRepository,
      securityService,
      projectSettingsRepository,
      adminTaskSuccessRepository,
      derivedState,
    },
    appDependencies: {
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
    },
    adminTaskSuccessRepository,
    securityService,
    adminAuth,
    derivedState,
  };
}
