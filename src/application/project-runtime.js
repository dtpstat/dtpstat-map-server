import path from 'node:path';
import {
  createProjectSettingsService,
} from '../modules/project/settings-service.js';
import {
  createProjectSettingsStorageRepository,
} from '../db/project-settings-storage-repository.js';
import {
  createPublicDownloadRepository,
} from '../db/public-download-repository.js';
import {
  createPublicDownloadService,
} from './public-downloads/service.js';
import {
  withIngestionDatabaseDependencies,
} from './ingestion-database-runtime.js';

/**
 * Compose project settings policy/use-case with SQL storage and shared
 * transaction/statistics infrastructure.
 */
export function createProjectSettingsRuntime(
  database,
  publicMapDefaults = {},
  dependencies = {},
) {
  return createProjectSettingsService(
    database,
    publicMapDefaults,
    {
      ...withIngestionDatabaseDependencies(
        dependencies,
      ),
      storage:
        dependencies.storage ??
        createProjectSettingsStorageRepository(),
    },
  );
}

/**
 * Compose project settings and the derived public-download publisher as one
 * application subsystem. SQL repositories remain infrastructure details.
 */
export function createProjectRuntime({
  database,
  publicMapDefaults = {},
  projectRoot,
  dependencies = {},
}) {
  const projectSettingsRepository =
    createProjectSettingsRuntime(
      database,
      publicMapDefaults,
      dependencies.projectSettings,
    );

  const publicDownloads =
    dependencies.publicDownloads ?? {};
  const publicDownloadRepository =
    publicDownloads.repository ??
    createPublicDownloadRepository(
      database,
    );
  const publicDownloadService =
    createPublicDownloadService({
      repository:
        publicDownloadRepository,
      projectSettingsRepository,
      directory:
        publicDownloads.directory ??
        path.join(
          projectRoot,
          'var',
          'public-downloads',
        ),
      ...(publicDownloads.replaceFiles
        ? {
            replaceFiles:
              publicDownloads.replaceFiles,
          }
        : {}),
    });

  return {
    projectSettingsRepository,
    publicDownloadService,
  };
}
