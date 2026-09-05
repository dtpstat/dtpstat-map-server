import { buildProjectSettingsPlan } from '../data/project-settings.js';

const SELECT_SETTINGS_SQL = `
  SELECT
    project_name AS "projectName",
    keywords,
    footer_html AS "footerHtml",
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
    updated_at = now()
  WHERE id = 1
  RETURNING
    project_name AS "projectName",
    keywords,
    footer_html AS "footerHtml",
    updated_at AS "updatedAt"
`;

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
    const plan = buildProjectSettingsPlan(payload);
    const result = await database.query(UPDATE_SETTINGS_SQL, [
      plan.projectName,
      plan.keywords,
      plan.footerHtml,
    ]);
    if (!result.rows[0]) {
      throw new Error('Project settings row is missing; run database migrations');
    }
    return result.rows[0];
  }

  return { get, save };
}
