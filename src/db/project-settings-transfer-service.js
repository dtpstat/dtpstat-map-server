import { normalizeAdminSecuritySettings } from '../data/admin-security.js';
import { buildLineTypesPlan } from '../data/line-types.js';
import { normalizeMapboxAccessToken } from '../data/mapbox-access-token.js';
import { buildProjectSettingsPlan, ProjectSettingsValidationError } from '../data/project-settings.js';
import {
  orderReportMetricsByDependencies,
  validateReportConfig,
} from '../data/report-config.js';
import { acquireDataImportLock } from './database-locks.js';
import { compileReportMetricQuery } from './report-config-service.js';

const SETTINGS_TRANSFER_SCHEMA_VERSION = 2;
const SETTINGS_TRANSFER_KIND = 'project-settings';
const LEGACY_SECURITY_DEFAULTS = Object.freeze({
  ipMaxFailedAttempts: 20,
  ipFailureWindowSeconds: 900,
  ipLockoutSeconds: 3600,
  sessionIdleSeconds: 1800,
  sessionAbsoluteSeconds: 43200,
  auditRetentionDays: 365,
});

export class ProjectSettingsTransferValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProjectSettingsTransferValidationError';
  }
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProjectSettingsTransferValidationError(`${label} must be an object`);
  }
  return value;
}

function validateEnvelope(payload) {
  const input = object(payload, 'settings transfer');
  const allowed = new Set([
    '_dtpstat', 'projectSettings', 'lineTypes', 'reportConfig', 'securitySettings',
  ]);
  const unknown = Object.keys(input).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new ProjectSettingsTransferValidationError(
      `settings transfer contains unsupported properties: ${unknown.join(', ')}`,
    );
  }

  const metadata = object(input._dtpstat, '_dtpstat');
  if (metadata.kind !== SETTINGS_TRANSFER_KIND) {
    throw new ProjectSettingsTransferValidationError(`_dtpstat.kind must be ${SETTINGS_TRANSFER_KIND}`);
  }
  if (![1, SETTINGS_TRANSFER_SCHEMA_VERSION].includes(metadata.schemaVersion)) {
    throw new ProjectSettingsTransferValidationError(
      `_dtpstat.schemaVersion must be 1 or ${SETTINGS_TRANSFER_SCHEMA_VERSION}`,
    );
  }
  return { input, schemaVersion: metadata.schemaVersion };
}

function normalizeProjectSettings(payload) {
  const input = object(payload, 'projectSettings');
  const hasMapboxAccessToken = Object.hasOwn(input, 'mapboxAccessToken');
  const {
    showLineLabels = false,
    mapboxAccessToken: rawMapboxAccessToken,
    ...base
  } = input;
  if (typeof showLineLabels !== 'boolean') {
    throw new ProjectSettingsValidationError('showLineLabels must be boolean');
  }
  return {
    ...buildProjectSettingsPlan(base),
    showLineLabels,
    hasMapboxAccessToken,
    mapboxAccessToken: hasMapboxAccessToken
      ? normalizeMapboxAccessToken(rawMapboxAccessToken, { optional: true })
      : null,
  };
}

function normalizeTransferredSecurity(payload, schemaVersion) {
  const input = object(payload, 'securitySettings');
  return normalizeAdminSecuritySettings(
    schemaVersion === 1 ? { ...LEGACY_SECURITY_DEFAULTS, ...input } : input,
  );
}

const EXPORT_PROJECT_SETTINGS_SQL = `
  SELECT project_name AS "projectName", keywords, footer_html AS "footerHtml",
    yandex_metrika_id AS "yandexMetrikaId",
    google_analytics_id AS "googleAnalyticsId",
    show_line_labels AS "showLineLabels",
    mapbox_access_token AS "mapboxAccessToken"
  FROM project_settings WHERE id = 1
`;

const EXPORT_LINE_TYPES_SQL = `
  SELECT code::integer AS code, name, title, color,
    line_style AS style, width::double precision AS width
  FROM line_types ORDER BY code
`;

const EXPORT_REPORT_CONFIG_SQL = `
  SELECT metrics, table_columns AS "tableColumns", csv_columns AS "csvColumns",
    rank_metric_key AS "rankMetricKey", rank_direction AS "rankDirection"
  FROM report_config WHERE id = 1
`;

const EXPORT_SECURITY_SETTINGS_SQL = `
  SELECT
    max_failed_attempts AS "maxFailedAttempts",
    failure_window_seconds AS "failureWindowSeconds",
    lockout_seconds AS "lockoutSeconds",
    ip_max_failed_attempts AS "ipMaxFailedAttempts",
    ip_failure_window_seconds AS "ipFailureWindowSeconds",
    ip_lockout_seconds AS "ipLockoutSeconds",
    session_idle_seconds AS "sessionIdleSeconds",
    session_absolute_seconds AS "sessionAbsoluteSeconds",
    audit_retention_days AS "auditRetentionDays"
  FROM admin_security_settings WHERE id = 1
`;

const UPDATE_PROJECT_SETTINGS_SQL = `
  UPDATE project_settings SET
    project_name=$1, keywords=$2::text[], footer_html=$3,
    yandex_metrika_id=$4, google_analytics_id=$5,
    show_line_labels=$6,
    mapbox_access_token=CASE WHEN $7::boolean THEN $8::text ELSE mapbox_access_token END,
    mapbox_access_token_initialized=CASE
      WHEN $7::boolean THEN TRUE
      ELSE mapbox_access_token_initialized
    END,
    updated_at=NOW()
  WHERE id=1
`;

const CREATE_LINE_TYPES_STAGE_SQL = `
  CREATE TEMP TABLE project_settings_line_types_stage (
    name text NOT NULL, title text NOT NULL, color text NOT NULL,
    line_style text NOT NULL, width double precision NOT NULL
  ) ON COMMIT DROP
`;

const INSERT_LINE_TYPES_STAGE_SQL = `
  INSERT INTO project_settings_line_types_stage(name,title,color,line_style,width)
  SELECT payload.name,payload.title,payload.color,payload.style,payload.width
  FROM jsonb_to_recordset($1::jsonb) AS payload(
    name text,title text,color text,style text,width double precision
  )
`;

const UPDATE_EXISTING_LINE_TYPES_SQL = `
  UPDATE line_types AS target SET
    title=stage.title, color=stage.color,
    line_style=stage.line_style, width=stage.width, updated_at=NOW()
  FROM project_settings_line_types_stage AS stage
  WHERE LOWER(BTRIM(target.name))=LOWER(BTRIM(stage.name))
`;

const INSERT_MISSING_LINE_TYPES_SQL = `
  INSERT INTO line_types(name,title,color,line_style,width)
  SELECT stage.name,stage.title,stage.color,stage.line_style,stage.width
  FROM project_settings_line_types_stage AS stage
  WHERE NOT EXISTS (
    SELECT 1 FROM line_types AS target
    WHERE LOWER(BTRIM(target.name))=LOWER(BTRIM(stage.name))
  )
`;

const SAVE_REPORT_CONFIG_SQL = `
  INSERT INTO report_config(
    id,metrics,table_columns,csv_columns,rank_metric_key,rank_direction,updated_at
  ) VALUES (1,$1::jsonb,$2::jsonb,$3::jsonb,$4,$5,NOW())
  ON CONFLICT(id) DO UPDATE SET
    metrics=EXCLUDED.metrics,
    table_columns=EXCLUDED.table_columns,
    csv_columns=EXCLUDED.csv_columns,
    rank_metric_key=EXCLUDED.rank_metric_key,
    rank_direction=EXCLUDED.rank_direction,
    updated_at=NOW()
`;

const UPDATE_SECURITY_SETTINGS_SQL = `
  UPDATE admin_security_settings SET
    max_failed_attempts=$1,
    failure_window_seconds=$2,
    lockout_seconds=$3,
    ip_max_failed_attempts=$4,
    ip_failure_window_seconds=$5,
    ip_lockout_seconds=$6,
    session_idle_seconds=$7,
    session_absolute_seconds=$8,
    audit_retention_days=$9,
    updated_at=NOW()
  WHERE id=1
`;

async function materializeReport(client, config) {
  await client.query('DELETE FROM city_report_values');
  const inserted = await client.query(`
    INSERT INTO city_report_values(city_id,values,updated_at)
    SELECT city.id,'{}'::jsonb,NOW()
    FROM cities AS city
    WHERE EXISTS (
      SELECT 1
      FROM city_boundaries AS boundary_presence
      WHERE boundary_presence.city_id = city.id
    )
      AND EXISTS (
        SELECT 1
        FROM city_geometries AS geometry_presence
        WHERE geometry_presence.city_id = city.id
      )
    ORDER BY city.id
    RETURNING city_id
  `);

  for (const metric of orderReportMetricsByDependencies(config.metrics)) {
    const query = compileReportMetricQuery(metric);
    await client.query(query.text, query.values);
  }

  await client.query(`
    UPDATE city_report_values
    SET rank_value=CASE
      WHEN jsonb_typeof(values -> $1)='number'
        THEN (values ->> $1)::double precision
      ELSE NULL
    END,
    updated_at=NOW()
  `, [config.rank.metricKey]);

  const order = config.rank.direction === 'asc' ? 'ASC' : 'DESC';
  await client.query(`
    WITH ranked AS (
      SELECT report.city_id,
        CASE
          WHEN report.rank_value IS NULL THEN NULL
          ELSE ROW_NUMBER() OVER (
            PARTITION BY COALESCE(city.is_large, FALSE)
            ORDER BY report.rank_value ${order} NULLS LAST, city.name ASC
          )::integer
        END AS rank
      FROM city_report_values AS report
      JOIN cities AS city ON city.id=report.city_id
    )
    UPDATE city_report_values AS report
    SET rank=ranked.rank, updated_at=NOW()
    FROM ranked
    WHERE ranked.city_id=report.city_id
  `);

  return inserted.rows.length;
}

async function rollbackQuietly(client) {
  try { await client.query('ROLLBACK'); }
  catch { /* preserve the original error */ }
}

/** @param {{connect: () => Promise<any>, databaseSchema?: string}} pool */
export function createProjectSettingsTransferService(pool) {
  return {
    async exportSettings() {
      const client = await pool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const [project, lineTypes, report, security] = await Promise.all([
          client.query(EXPORT_PROJECT_SETTINGS_SQL),
          client.query(EXPORT_LINE_TYPES_SQL),
          client.query(EXPORT_REPORT_CONFIG_SQL),
          client.query(EXPORT_SECURITY_SETTINGS_SQL),
        ]);
        const projectSettings = project.rows[0];
        const reportRow = report.rows[0];
        const securitySettings = security.rows[0];
        if (!projectSettings || !reportRow || !securitySettings) {
          throw new Error('Project settings are incomplete; run database migrations');
        }
        await client.query('COMMIT');
        return {
          _dtpstat: {
            kind: SETTINGS_TRANSFER_KIND,
            schemaVersion: SETTINGS_TRANSFER_SCHEMA_VERSION,
            exportedAt: new Date().toISOString(),
          },
          projectSettings,
          lineTypes: lineTypes.rows,
          reportConfig: {
            metrics: reportRow.metrics,
            tableColumns: reportRow.tableColumns,
            csvColumns: reportRow.csvColumns,
            rank: {
              metricKey: reportRow.rankMetricKey,
              direction: reportRow.rankDirection,
            },
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
      const { input, schemaVersion } = validateEnvelope(payload);
      const projectSettings = normalizeProjectSettings(input.projectSettings);
      const lineTypes = buildLineTypesPlan({ lineTypes: input.lineTypes }).lineTypes;
      const securitySettings = normalizeTransferredSecurity(input.securitySettings, schemaVersion);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await acquireDataImportLock(client, pool);

        await client.query(CREATE_LINE_TYPES_STAGE_SQL);
        await client.query(INSERT_LINE_TYPES_STAGE_SQL, [
          JSON.stringify(lineTypes.map(({ name, title, color, style, width }) => ({
            name, title, color, style, width,
          }))),
        ]);
        await client.query(UPDATE_EXISTING_LINE_TYPES_SQL);
        await client.query(INSERT_MISSING_LINE_TYPES_SQL);

        const currentLineTypes = await client.query('SELECT name FROM line_types ORDER BY id');
        const reportConfig = validateReportConfig(input.reportConfig, {
          allowedLineTypeNames: currentLineTypes.rows.map((row) => row.name),
        });

        await client.query(UPDATE_PROJECT_SETTINGS_SQL, [
          projectSettings.projectName,
          projectSettings.keywords,
          projectSettings.footerHtml,
          projectSettings.yandexMetrikaId,
          projectSettings.googleAnalyticsId,
          projectSettings.showLineLabels,
          projectSettings.hasMapboxAccessToken,
          projectSettings.mapboxAccessToken,
        ]);
        await client.query(SAVE_REPORT_CONFIG_SQL, [
          JSON.stringify(reportConfig.metrics),
          JSON.stringify(reportConfig.tableColumns),
          JSON.stringify(reportConfig.csvColumns),
          reportConfig.rank.metricKey,
          reportConfig.rank.direction,
        ]);
        await client.query(UPDATE_SECURITY_SETTINGS_SQL, [
          securitySettings.maxFailedAttempts,
          securitySettings.failureWindowSeconds,
          securitySettings.lockoutSeconds,
          securitySettings.ipMaxFailedAttempts,
          securitySettings.ipFailureWindowSeconds,
          securitySettings.ipLockoutSeconds,
          securitySettings.sessionIdleSeconds,
          securitySettings.sessionAbsoluteSeconds,
          securitySettings.auditRetentionDays,
        ]);

        const materializedCities = await materializeReport(client, reportConfig);
        await client.query('COMMIT');
        return {
          projectName: projectSettings.projectName,
          lineTypes: lineTypes.length,
          metrics: reportConfig.metrics.length,
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

export const PROJECT_SETTINGS_TRANSFER_SCHEMA_VERSION = SETTINGS_TRANSFER_SCHEMA_VERSION;
