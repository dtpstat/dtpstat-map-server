import {
  buildProjectSettingsPlan,
  ProjectSettingsValidationError,
} from '../data/project-settings.js';
import { normalizeMapboxAccessToken } from '../data/mapbox-access-token.js';

const SELECT_SETTINGS_SQL = `
  SELECT
    project_name AS "projectName",
    keywords,
    footer_html AS "footerHtml",
    yandex_metrika_id AS "yandexMetrikaId",
    google_analytics_id AS "googleAnalyticsId",
    show_line_labels AS "showLineLabels",
    (mapbox_access_token IS NOT NULL) AS "mapboxAccessTokenConfigured",
    updated_at AS "updatedAt"
  FROM project_settings
  WHERE id = 1
`;

const SELECT_MAPBOX_TOKEN_SQL = `
  SELECT mapbox_access_token AS "mapboxAccessToken"
  FROM project_settings
  WHERE id = 1
`;

const SELECT_MAPBOX_BOOTSTRAP_STATE_SQL = `
  SELECT
    mapbox_access_token_initialized AS initialized,
    (mapbox_access_token IS NOT NULL) AS configured
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
    mapbox_access_token = CASE
      WHEN $7::text IS NULL THEN mapbox_access_token
      ELSE $7::text
    END,
    mapbox_access_token_initialized = CASE
      WHEN $7::text IS NULL THEN mapbox_access_token_initialized
      ELSE TRUE
    END,
    updated_at = now()
  WHERE id = 1
  RETURNING
    project_name AS "projectName",
    keywords,
    footer_html AS "footerHtml",
    yandex_metrika_id AS "yandexMetrikaId",
    google_analytics_id AS "googleAnalyticsId",
    show_line_labels AS "showLineLabels",
    (mapbox_access_token IS NOT NULL) AS "mapboxAccessTokenConfigured",
    updated_at AS "updatedAt"
`;

const BOOTSTRAP_MAPBOX_TOKEN_SQL = `
  UPDATE project_settings
  SET
    mapbox_access_token = $1,
    mapbox_access_token_initialized = TRUE,
    updated_at = NOW()
  WHERE id = 1
    AND mapbox_access_token_initialized = FALSE
  RETURNING
    (mapbox_access_token IS NOT NULL) AS "mapboxAccessTokenConfigured"
`;

function splitProjectSettingsPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ProjectSettingsValidationError('Request body must be a JSON object');
  }
  const {
    showLineLabels = false,
    mapboxAccessToken = null,
    ...base
  } = payload;
  if (typeof showLineLabels !== 'boolean') {
    throw new ProjectSettingsValidationError('showLineLabels must be boolean');
  }
  return {
    plan: buildProjectSettingsPlan(base),
    showLineLabels,
    mapboxAccessToken: normalizeMapboxAccessToken(mapboxAccessToken, { optional: true }),
  };
}

/**
 * @param {{ query: (text: string, values?: unknown[]) => Promise<{rows: any[]}> }} database
 * @param {{ styleUrl?: string, initialCenter?: number[], initialZoom?: number }} publicMapDefaults
 */
export function createProjectSettingsRepository(database, publicMapDefaults = {}) {
  async function get() {
    const result = await database.query(SELECT_SETTINGS_SQL);
    if (!result.rows[0]) {
      throw new Error('Project settings row is missing; run database migrations');
    }
    return result.rows[0];
  }

  async function getMapboxAccessToken() {
    const result = await database.query(SELECT_MAPBOX_TOKEN_SQL);
    if (!result.rows[0]) {
      throw new Error('Project settings row is missing; run database migrations');
    }
    return result.rows[0].mapboxAccessToken ?? null;
  }

  async function getPublicMapConfig() {
    return {
      accessToken: await getMapboxAccessToken(),
      styleUrl: publicMapDefaults.styleUrl,
      initialCenter: publicMapDefaults.initialCenter,
      initialZoom: publicMapDefaults.initialZoom,
    };
  }

  async function bootstrapMapboxAccessToken(value) {
    const stateResult = await database.query(SELECT_MAPBOX_BOOTSTRAP_STATE_SQL);
    const state = stateResult.rows[0];
    if (!state) {
      throw new Error('Project settings row is missing; run database migrations');
    }
    if (state.initialized) {
      return { initialized: false, configured: Boolean(state.configured) };
    }

    const token = normalizeMapboxAccessToken(value, { optional: true });
    if (!token) {
      return { initialized: false, configured: false };
    }
    const result = await database.query(BOOTSTRAP_MAPBOX_TOKEN_SQL, [token]);
    return {
      initialized: result.rows.length > 0,
      configured: Boolean(result.rows[0]?.mapboxAccessTokenConfigured),
    };
  }

  async function save(payload) {
    const { plan, showLineLabels, mapboxAccessToken } = splitProjectSettingsPayload(payload);
    const result = await database.query(UPDATE_SETTINGS_SQL, [
      plan.projectName,
      plan.keywords,
      plan.footerHtml,
      plan.yandexMetrikaId,
      plan.googleAnalyticsId,
      showLineLabels,
      mapboxAccessToken,
    ]);
    if (!result.rows[0]) {
      throw new Error('Project settings row is missing; run database migrations');
    }
    return result.rows[0];
  }

  return {
    get,
    save,
    getMapboxAccessToken,
    getPublicMapConfig,
    bootstrapMapboxAccessToken,
  };
}
