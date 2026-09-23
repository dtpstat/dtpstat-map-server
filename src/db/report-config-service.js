import {
  createReportConfigService as createReportConfigUseCase,
} from '../modules/reporting/config-service.js';
export {
  compileReportMetricQuery,
  compileReportRankQuery,
} from '../modules/reporting/query-compiler.js';
import { acquireDataImportLock } from './database-locks.js';
import {
  createReportConfigRepository,
} from './report-config-repository.js';
import {
  materializeReportValues,
} from './report-materialization-repository.js';

/**
 * DB composition adapter for report configuration and materialization.
 *
 * @param {{ connect: () => Promise<any>, query: (...args: any[]) => Promise<any> }} pool
 * @param {{
 *   repository?: ReturnType<typeof createReportConfigRepository>,
 *   materialize?: typeof materializeReportValues,
 *   acquireLock?: (client: any, pool: any) => Promise<void>
 * }} [dependencies]
 */
export function createReportConfigService(
  pool,
  dependencies = {},
) {
  return createReportConfigUseCase(pool, {
    ...dependencies,
    repository:
      dependencies.repository ?? createReportConfigRepository(),
    materialize:
      dependencies.materialize ?? materializeReportValues,
    acquireLock:
      dependencies.acquireLock ?? acquireDataImportLock,
  });
}
