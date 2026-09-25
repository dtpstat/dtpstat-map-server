import {
  createProjectSettingsTransferService,
} from './data-transfer/project-settings-service.js';
import {
  createReportConfigService,
} from '../modules/reporting/config-service.js';
import {
  acquireDataImportLock,
} from '../db/database-locks.js';
import {
  createProjectSettingsTransferRepository,
} from '../db/project-settings-transfer-repository.js';
import {
  createReportConfigRepository,
} from '../db/report-config-repository.js';
import {
  materializeReportValues,
} from '../db/report-materialization-repository.js';

/**
 * Compose project settings transfer with its persistence and transaction lock.
 */
export function createProjectSettingsTransferRuntime(
  pool,
  dependencies = {},
) {
  return createProjectSettingsTransferService(
    pool,
    {
      ...dependencies,
      repository:
        dependencies.repository ??
        createProjectSettingsTransferRepository(),
      acquireLock:
        dependencies.acquireLock ??
        acquireDataImportLock,
    },
  );
}

/**
 * Compose report configuration with storage, materialization and transaction
 * locking. Query compilation remains owned by the reporting module.
 */
export function createReportConfigRuntime(
  pool,
  dependencies = {},
) {
  return createReportConfigService(
    pool,
    {
      ...dependencies,
      repository:
        dependencies.repository ??
        createReportConfigRepository(),
      materialize:
        dependencies.materialize ??
        materializeReportValues,
      acquireLock:
        dependencies.acquireLock ??
        acquireDataImportLock,
    },
  );
}
