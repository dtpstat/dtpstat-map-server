import {
  buildProjectSettingsPlan,
  normalizePublicThemePreset,
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
    theme_preset AS "themePreset",
    show_line_labels AS "showLineLabels",
    show_line_popups AS "showLinePopups",
    (mapbox_access_token IS NOT NULL) AS "mapboxAccessTokenConfigured",
    (city_marker_icon IS NOT NULL) AS "cityMarkerIconConfigured",
    city_marker_icon_width::integer AS "cityMarkerIconWidth",
    city_marker_icon_height::integer AS "cityMarkerIconHeight",
    updated_at AS "updatedAt"
  FROM project_settings
  WHERE id = 1
`;

const SELECT_MAPBOX_TOKEN_SQL = `
  SELECT mapbox_access_token AS "mapboxAccessToken"
  FROM project_settings
  WHERE id = 1
`;

const SELECT_CITY_MARKER_ICON_SQL = `
  SELECT
    city_marker_icon AS data,
    city_marker_icon_mime AS mime,
    city_marker_icon_width::integer AS width,
    city_marker_icon_height::integer AS height
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
    theme_preset = COALESCE($6::text, theme_preset),
    show_line_labels = $7,
    show_line_popups = COALESCE($8::boolean, show_line_popups),
    mapbox_access_token = CASE
      WHEN $9::text IS NULL THEN mapbox_access_token
      ELSE $9::text
    END,
    mapbox_access_token_initialized = CASE
      WHEN $9::text IS NULL THEN mapbox_access_token_initialized
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
    theme_preset AS "themePreset",
    show_line_labels AS "showLineLabels",
    show_line_popups AS "showLinePopups",
    (mapbox_access_token IS NOT NULL) AS "mapboxAccessTokenConfigured",
    (city_marker_icon IS NOT NULL) AS "cityMarkerIconConfigured",
    city_marker_icon_width::integer AS "cityMarkerIconWidth",
    city_marker_icon_height::integer AS "cityMarkerIconHeight",
    updated_at AS "updatedAt"
`;

const UPDATE_CITY_MARKER_ICON_SQL = `
  UPDATE project_settings
  SET
    city_marker_icon = $1,
    city_marker_icon_mime = $2,
    city_marker_icon_width = $3,
    city_marker_icon_height = $4,
    updated_at = now()
  WHERE id = 1
  RETURNING
    TRUE AS "cityMarkerIconConfigured",
    city_marker_icon_width::integer AS "cityMarkerIconWidth",
    city_marker_icon_height::integer AS "cityMarkerIconHeight",
    updated_at AS "updatedAt"
`;

const CLEAR_CITY_MARKER_ICON_SQL = `
  UPDATE project_settings
  SET
    city_marker_icon = NULL,
    city_marker_icon_mime = NULL,
    city_marker_icon_width = NULL,
    city_marker_icon_height = NULL,
    updated_at = now()
  WHERE id = 1
  RETURNING
    FALSE AS "cityMarkerIconConfigured",
    NULL::integer AS "cityMarkerIconWidth",
    NULL::integer AS "cityMarkerIconHeight",
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
  const hasShowLinePopups = Object.hasOwn(payload, 'showLinePopups');
  const {
    themePreset: rawThemePreset,
    showLineLabels = false,
    showLinePopups: rawShowLinePopups,
    mapboxAccessToken = null,
    ...base
  } = payload;
  if (typeof showLineLabels !== 'boolean') {
    throw new ProjectSettingsValidationError('showLineLabels must be boolean');
  }
  if (hasShowLinePopups && typeof rawShowLinePopups !== 'boolean') {
    throw new ProjectSettingsValidationError('showLinePopups must be boolean');
  }
  return {
    plan: buildProjectSettingsPlan(base),
    themePreset: rawThemePreset === undefined
      ? null
      : normalizePublicThemePreset(rawThemePreset),
    showLineLabels,
    showLinePopups: hasShowLinePopups ? rawShowLinePopups : null,
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

  async function getCityMarkerIcon() {
    const result = await database.query(SELECT_CITY_MARKER_ICON_SQL);
    const row = result.rows[0];
    if (!row) {
      throw new Error('Project settings row is missing; run database migrations');
    }
    if (!row.data) return null;
    return {
      data: row.data,
      mime: row.mime,
      width: row.width,
      height: row.height,
    };
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
    const {
      plan,
      themePreset,
      showLineLabels,
      showLinePopups,
      mapboxAccessToken,
    } = splitProjectSettingsPayload(payload);
    const result = await database.query(UPDATE_SETTINGS_SQL, [
      plan.projectName,
      plan.keywords,
      plan.footerHtml,
      plan.yandexMetrikaId,
      plan.googleAnalyticsId,
      themePreset,
      showLineLabels,
      showLinePopups,
      mapboxAccessToken,
    ]);
    if (!result.rows[0]) {
      throw new Error('Project settings row is missing; run database migrations');
    }
    return result.rows[0];
  }

  async function saveCityMarkerIcon(icon) {
    const result = await database.query(UPDATE_CITY_MARKER_ICON_SQL, [
      icon.data,
      icon.mime,
      icon.width,
      icon.height,
    ]);
    if (!result.rows[0]) {
      throw new Error('Project settings row is missing; run database migrations');
    }
    return result.rows[0];
  }

  async function clearCityMarkerIcon() {
    const result = await database.query(CLEAR_CITY_MARKER_ICON_SQL);
    if (!result.rows[0]) {
      throw new Error('Project settings row is missing; run database migrations');
    }
    return result.rows[0];
  }

  return {
    get,
    save,
    getMapboxAccessToken,
    getCityMarkerIcon,
    getPublicMapConfig,
    bootstrapMapboxAccessToken,
    saveCityMarkerIcon,
    clearCityMarkerIcon,
  };
}