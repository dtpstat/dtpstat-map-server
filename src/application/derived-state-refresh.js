import {
  runServiceOperation,
} from '../service-log.js';

const DERIVED_REFRESH_TASK_TYPES =
  new Set([
    'geojson-import',
    'city-geojson-import',
    'kml-update',
    'osm-city-update',
    'population-update',
  ]);

/**
 * Centralize refresh of DB-derived report values and materialized public
 * downloads. Callers supply only the reason/details for the refresh.
 *
 * @param {{
 *   publicDownloadService: {
 *     directory: string,
 *     refresh: () => Promise<any>
 *   },
 *   reportConfigService: {
 *     refresh: () => Promise<any>
 *   },
 *   runOperation?: typeof runServiceOperation
 * }} dependencies
 */
export function createDerivedStateRefresh({
  publicDownloadService,
  reportConfigService,
  runOperation = runServiceOperation,
}) {
  const refreshPublicDownloads =
    (details = {}) =>
      runOperation(
        'public-downloads.refresh',
        () =>
          publicDownloadService.refresh(),
        {
          details: {
            directory:
              publicDownloadService.directory,
            ...details,
          },
          successDetails:
            (result) => result,
        },
      );

  const refreshReportValues =
    (details = {}) =>
      runOperation(
        'city-report.refresh',
        () =>
          reportConfigService.refresh(),
        {
          details,
          successDetails:
            (result) => result,
        },
      );

  const refreshAll =
    async (details = {}) => {
      await refreshReportValues(details);
      return refreshPublicDownloads(
        details,
      );
    };

  return {
    refreshPublicDownloads,
    refreshReportValues,
    refreshAll,
  };
}

/**
 * Build the admin-task post-success hook for updates that change report/public
 * derived state. Other successful task types remain no-ops.
 *
 * @param {{ refreshAll: (details?: object) => Promise<any> }} derivedState
 */
export function createAdminTaskDerivedRefresh(
  derivedState,
) {
  return async function afterSuccessfulUpdate(
    update,
  ) {
    if (
      !DERIVED_REFRESH_TASK_TYPES.has(
        update.taskType,
      )
    ) {
      return undefined;
    }

    return derivedState.refreshAll({
      reason: 'admin-update',
      taskType: update.taskType,
      taskId: update.taskId,
    });
  };
}
