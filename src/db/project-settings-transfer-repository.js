import { RECALCULATE_CITY_STATISTICS_SQL } from './recalculate-city-statistics.js';
import {
  materializeReportValues,
} from './report-materialization-repository.js';

const EXPORT_PROJECT_SETTINGS_SQL = `
  SELECT project_name AS "projectName", keywords, footer_html AS "footerHtml",
    yandex_metrika_id AS "yandexMetrikaId",
    google_analytics_id AS "googleAnalyticsId",
    theme_preset AS "themePreset",
    show_line_labels AS "showLineLabels",
    show_line_popups AS "showLinePopups",
    large_city_population_threshold::integer AS "largeCityPopulationThreshold",
    large_city_area_km2_threshold::double precision AS "largeCityAreaKm2Threshold",
    public_download_name AS "publicDownloadName",
    mapbox_access_token AS "mapboxAccessToken"
  FROM project_settings WHERE id = 1
`;

const EXPORT_LINE_TYPES_SQL = `
  SELECT code::integer AS code, name, title, color,
    line_style AS style, width::double precision AS width
  FROM line_types ORDER BY code
`;

const EXPORT_REPORT_CONFIG_SQL = `
  SELECT jsonb_object_agg(config_key, config_value) AS config
  FROM report_config
  WHERE config_key IN ('metrics', 'table_columns', 'csv_columns', 'rank')
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
    audit_retention_days AS "auditRetentionDays",
    password_min_length AS "passwordMinLength",
    password_max_length AS "passwordMaxLength",
    password_require_lowercase AS "passwordRequireLowercase",
    password_require_uppercase AS "passwordRequireUppercase",
    password_require_digit AS "passwordRequireDigit",
    password_require_special AS "passwordRequireSpecial"
  FROM admin_security_settings WHERE id = 1
`;

const UPDATE_PROJECT_SETTINGS_SQL = `
  UPDATE project_settings SET
    project_name=$1, keywords=$2::text[], footer_html=$3,
    yandex_metrika_id=$4, google_analytics_id=$5,
    theme_preset=$6,
    show_line_labels=$7,
    show_line_popups=$8,
    public_download_name=CASE WHEN $9::boolean THEN $10::text ELSE public_download_name END,
    mapbox_access_token=CASE WHEN $11::boolean THEN $12::text ELSE mapbox_access_token END,
    mapbox_access_token_initialized=CASE
      WHEN $11::boolean THEN TRUE
      ELSE mapbox_access_token_initialized
    END,
    large_city_population_threshold=$13,
    large_city_area_km2_threshold=$14,
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
  INSERT INTO report_config(config_key, config_value, updated_at)
  VALUES
    ('metrics', $1::jsonb, NOW()),
    ('table_columns', $2::jsonb, NOW()),
    ('csv_columns', $3::jsonb, NOW()),
    ('rank', $4::jsonb, NOW())
  ON CONFLICT(config_key) DO UPDATE SET
    config_value=EXCLUDED.config_value,
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
    password_min_length=$10,
    password_max_length=$11,
    password_require_lowercase=$12,
    password_require_uppercase=$13,
    password_require_digit=$14,
    password_require_special=$15,
    updated_at=NOW()
  WHERE id=1
`;

export function createProjectSettingsTransferRepository() {
  return {
    async exportSnapshot(client) {
      // pg Client queries must not overlap. Besides avoiding the pg@8
      // deprecation, sequential reads remain one consistent snapshot because
      // the application service wraps this repository call in REPEATABLE READ.
      const project =
        await client.query(
          EXPORT_PROJECT_SETTINGS_SQL,
        );

      const lineTypes =
        await client.query(
          EXPORT_LINE_TYPES_SQL,
        );

      const report =
        await client.query(
          EXPORT_REPORT_CONFIG_SQL,
        );

      const security =
        await client.query(
          EXPORT_SECURITY_SETTINGS_SQL,
        );

      return {
        projectSettings: project.rows[0],
        lineTypes: lineTypes.rows,
        reportConfigPresent: Boolean(report.rows[0]),
        reportConfig: report.rows[0]?.config,
        securitySettings: security.rows[0],
      };
    },

    async replaceLineTypes(client, lineTypes) {
      await client.query(CREATE_LINE_TYPES_STAGE_SQL);
      await client.query(INSERT_LINE_TYPES_STAGE_SQL, [
        JSON.stringify(
          lineTypes.map(({ name, title, color, style, width }) => ({
            name,
            title,
            color,
            style,
            width,
          })),
        ),
      ]);
      await client.query(UPDATE_EXISTING_LINE_TYPES_SQL);
      await client.query(INSERT_MISSING_LINE_TYPES_SQL);
    },

    async currentLineTypeNames(client) {
      const result = await client.query(
        'SELECT name FROM line_types ORDER BY id',
      );
      return result.rows.map((row) => row.name);
    },

    updateProjectSettings(client, settings) {
      return client.query(UPDATE_PROJECT_SETTINGS_SQL, [
        settings.projectName,
        settings.keywords,
        settings.footerHtml,
        settings.yandexMetrikaId,
        settings.googleAnalyticsId,
        settings.themePreset,
        settings.showLineLabels,
        settings.showLinePopups,
        settings.hasPublicDownloadName,
        settings.publicDownloadName,
        settings.hasMapboxAccessToken,
        settings.mapboxAccessToken,
        settings.largeCityPopulationThreshold,
        settings.largeCityAreaKm2Threshold,
      ]);
    },

    saveReportConfig(client, config) {
      return client.query(SAVE_REPORT_CONFIG_SQL, [
        JSON.stringify(config.metrics),
        JSON.stringify(config.tableColumns),
        JSON.stringify(config.csvColumns),
        JSON.stringify({ sort: config.rank.sort }),
      ]);
    },

    updateSecuritySettings(client, settings) {
      return client.query(UPDATE_SECURITY_SETTINGS_SQL, [
        settings.maxFailedAttempts,
        settings.failureWindowSeconds,
        settings.lockoutSeconds,
        settings.ipMaxFailedAttempts,
        settings.ipFailureWindowSeconds,
        settings.ipLockoutSeconds,
        settings.sessionIdleSeconds,
        settings.sessionAbsoluteSeconds,
        settings.auditRetentionDays,
        settings.passwordMinLength,
        settings.passwordMaxLength,
        settings.passwordRequireLowercase,
        settings.passwordRequireUppercase,
        settings.passwordRequireDigit,
        settings.passwordRequireSpecial,
      ]);
    },

    recalculateStatistics(client) {
      return client.query(RECALCULATE_CITY_STATISTICS_SQL);
    },

    async materializeReport(client, config) {
      const result = await materializeReportValues(client, config);
      return result.cities;

    },
  };
}
