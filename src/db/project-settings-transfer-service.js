import {
  createProjectSettingsTransferService as createProjectSettingsTransferUseCase,
  PROJECT_SETTINGS_TRANSFER_SCHEMA_VERSION,
  ProjectSettingsTransferValidationError,
} from '../application/data-transfer/project-settings-service.js';
import { acquireDataImportLock } from './database-locks.js';
import {
  createProjectSettingsTransferRepository,
} from './project-settings-transfer-repository.js';

export {
  PROJECT_SETTINGS_TRANSFER_SCHEMA_VERSION,
  ProjectSettingsTransferValidationError,
};

/**
 * DB composition adapter for project settings transfer.
 *
 * @param {{ connect: () => Promise<any>, databaseSchema?: string }} pool
 * @param {{
 *   repository?: ReturnType<typeof createProjectSettingsTransferRepository>,
 *   acquireLock?: (client: any, pool: any) => Promise<void>
 * }} [dependencies]
 */
export function createProjectSettingsTransferService(
  pool,
  dependencies = {},
) {
  return createProjectSettingsTransferUseCase(pool, {
    ...dependencies,
    repository:
      dependencies.repository ??
      createProjectSettingsTransferRepository(),
    acquireLock:
      dependencies.acquireLock ?? acquireDataImportLock,
  });
}
