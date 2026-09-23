import { buildLineTypesPlan } from '../../data/line-types.js';
import { validateReportConfig } from '../../data/report-config.js';
import {
  normalizeTransferredProjectSettings,
  normalizeTransferredSecuritySettings,
  PROJECT_SETTINGS_TRANSFER_KIND,
  PROJECT_SETTINGS_TRANSFER_SCHEMA_VERSION,
  ProjectSettingsTransferValidationError,
  validateProjectSettingsTransferEnvelope,
} from '../../modules/project/settings-transfer-policy.js';

export {
  PROJECT_SETTINGS_TRANSFER_SCHEMA_VERSION,
  ProjectSettingsTransferValidationError,
};

async function rollbackQuietly(client) {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Preserve the original error.
  }
}

/**
 * @param {{ connect: () => Promise<any>, databaseSchema?: string }} pool
 * @param {{
 *   repository: {
 *     exportSnapshot(client: any): Promise<any>,
 *     replaceLineTypes(client: any, lineTypes: any[]): Promise<void>,
 *     currentLineTypeNames(client: any): Promise<string[]>,
 *     updateProjectSettings(client: any, settings: any): Promise<any>,
 *     saveReportConfig(client: any, config: any): Promise<any>,
 *     updateSecuritySettings(client: any, settings: any): Promise<any>,
 *     recalculateStatistics(client: any): Promise<any>,
 *     materializeReport(client: any, config: any): Promise<number>
 *   },
 *   acquireLock: (client: any, pool: any) => Promise<void>
 * }} dependencies
 */
export function createProjectSettingsTransferService(
  pool,
  dependencies,
) {
  const repository = dependencies?.repository;
  const acquireLock = dependencies?.acquireLock;

  if (!repository) {
    throw new TypeError(
      'Project settings transfer repository dependency is required',
    );
  }
  if (typeof acquireLock !== 'function') {
    throw new TypeError(
      'Project settings transfer acquireLock dependency is required',
    );
  }

  return {
    async exportSettings() {
      const client = await pool.connect();
      try {
        await client.query(
          'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
        );
        const snapshot = await repository.exportSnapshot(client);
        const {
          projectSettings,
          lineTypes,
          reportConfig: storedReportConfig,
          securitySettings,
        } = snapshot;

        if (!projectSettings || !storedReportConfig || !securitySettings) {
          throw new Error(
            'Project settings are incomplete; run database migrations',
          );
        }
        if (
          typeof storedReportConfig !== 'object' ||
          Array.isArray(storedReportConfig)
        ) {
          throw new Error(
            'Report configuration is incomplete; run database migrations',
          );
        }

        await client.query('COMMIT');
        return {
          _dtpstat: {
            kind: PROJECT_SETTINGS_TRANSFER_KIND,
            schemaVersion: PROJECT_SETTINGS_TRANSFER_SCHEMA_VERSION,
            exportedAt: new Date().toISOString(),
          },
          projectSettings,
          lineTypes,
          reportConfig: {
            metrics: storedReportConfig.metrics,
            tableColumns: storedReportConfig.table_columns,
            csvColumns: storedReportConfig.csv_columns,
            rank: storedReportConfig.rank,
          },
          securitySettings,
        };
      } catch (error) {
        await rollbackQuietly(client);
        throw error;
      } finally {
        client.release();
      }
    },

    async importSettings(payload) {
      const { input, schemaVersion } =
        validateProjectSettingsTransferEnvelope(payload);
      const projectSettings =
        normalizeTransferredProjectSettings(input.projectSettings);
      const lineTypes =
        buildLineTypesPlan({ lineTypes: input.lineTypes }).lineTypes;
      const securitySettings =
        normalizeTransferredSecuritySettings(
          input.securitySettings,
          schemaVersion,
        );

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await acquireLock(client, pool);

        await repository.replaceLineTypes(client, lineTypes);
        const currentLineTypeNames =
          await repository.currentLineTypeNames(client);
        const reportConfig = validateReportConfig(input.reportConfig, {
          allowedLineTypeNames: currentLineTypeNames,
        });

        await repository.updateProjectSettings(
          client,
          projectSettings,
        );
        await repository.saveReportConfig(client, reportConfig);
        await repository.updateSecuritySettings(
          client,
          securitySettings,
        );
        await repository.recalculateStatistics(client);
        const materializedCities =
          await repository.materializeReport(client, reportConfig);

        await client.query('COMMIT');
        return {
          projectName: projectSettings.projectName,
          publicDownloadName: projectSettings.publicDownloadName,
          lineTypes: lineTypes.length,
          metrics: reportConfig.metrics.length,
          rankSort: reportConfig.rank.sort,
          materializedCities,
          transferSchemaVersion: schemaVersion,
        };
      } catch (error) {
        await rollbackQuietly(client);
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
