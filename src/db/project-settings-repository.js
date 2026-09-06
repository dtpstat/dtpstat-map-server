import {
  buildProjectSettingsPlan,
  ProjectSettingsValidationError,
} from '../data/project-settings.js';

const SELECT_SETTINGS_SQL = `
  SELECT
    project_name AS "projectName",
    keywords,
    footer_html AS "footerHtml",
    yandex_metrika_id AS "yandexMetrikaId",
    google_analytics_id AS "googleAnalyticsId",
    show_line_labels AS "showLineLabels",
    updated_at AS "updatedAt"
  FROM project_settings
  WHERE id = 1
`;

const UPDATE_SETTINGS_SQL = `
  UPDATE project_settings
  SET
    project_name = $1,
    keywords = $2::text[],
    footer_html = $3,
    yandex_metrika_id = $4,
    google_analytics_id = $5,
    show_line_labels = $6,
    updated_at = now()
  WHERE id = 1
  RETURNING
    project_name AS "projectName",
    keywords,
    footer_html AS "footerHtml",
    yandex_metrika_id AS "yandexMetrikaId",
    google_analytics_id AS "googleAnalyticsId",
    show_line_labels AS "showLineLabels",
    updated_at AS "updatedAt"
`;

function splitProjectSettingsPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ProjectSettingsValidationError('Request body must be a JSON object');
  }
  const { showLineLabels = false, ...base } = payload;
  if (typeof showLineLabels !== 'boolean') {
    throw new ProjectSettingsValidationError('showLineLabels must be boolean');
  }
  return {
    plan: buildProjectSettingsPlan(base),
    showLineLabels,
  };
}

/**
 * @param {{ query: (text: string, values?: unknown[]) => Promise<{rows: any[]}> }} database
 */
export function createProjectSettingsRepository(database) {
  async function get() {
    const result = await database.query(SELECT_SETTINGS_SQL);
    if (!result.rows[0]) {
      throw new Error('Project settings row is missing; run database migrations');
    }
    return result.rows[0];
  }

  async function save(payload) {
    const { plan, showLineLabels } = splitProjectSettingsPayload(payload);
    const result = await database.query(UPDATE_SETTINGS_SQL, [
      plan.projectName,
      plan.keywords,
      plan.footerHtml,
      plan.yandexMetrikaId,
      plan.googleAnalyticsId,
      showLineLabels,
    ]);
    if (!result.rows[0]) {
      throw new Error('Project settings row is missing; run database migrations');
    }
    return result.rows[0];
  }

  return { get, save };
}
