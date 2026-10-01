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
    show_geometry_timeline AS "showGeometryTimeline",
    history_start_date::text AS "historyStartDate",
    show_point_geometries AS "showPointGeometries",
    show_line_geometries AS "showLineGeometries",
    show_polygon_geometries AS "showPolygonGeometries",
    large_city_population_threshold::integer AS "largeCityPopulationThreshold",
    large_city_area_km2_threshold::double precision AS "largeCityAreaKm2Threshold",
    public_download_name AS "publicDownloadName",
    (mapbox_access_token IS NOT NULL) AS "mapboxAccessTokenConfigured",
    (city_marker_icon IS NOT NULL) AS "cityMarkerIconConfigured",
    city_marker_icon_width::integer AS "cityMarkerIconWidth",
    city_marker_icon_height::integer AS "cityMarkerIconHeight",
    updated_at AS "updatedAt"
  FROM project_settings
  WHERE id = 1
`;

const SELECT_HISTORY_SPEEDS_SQL = `
  SELECT
    id::integer AS id,
    name,
    step_unit AS "stepUnit",
    interval_seconds::double precision AS "intervalSeconds",
    sort_order::integer AS "sortOrder",
    is_active AS "isActive",
    is_default AS "isDefault"
  FROM geometry_history_speeds
  ORDER BY sort_order, id
`;

const DELETE_HISTORY_SPEEDS_SQL = `
  DELETE FROM geometry_history_speeds
`;

const INSERT_HISTORY_SPEED_SQL = `
  INSERT INTO geometry_history_speeds (
    name,
    step_unit,
    interval_seconds,
    sort_order,
    is_active,
    is_default
  )
  VALUES (
    $1::text,
    $2::text,
    $3::double precision,
    $4::integer,
    $5::boolean,
    $6::boolean
  )
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
    project_name = $1::text,
    keywords = $2::text[],
    footer_html = $3::text,
    yandex_metrika_id = $4::text,
    google_analytics_id = $5::text,
    theme_preset = COALESCE($6::text, theme_preset),
    show_line_labels = $7::boolean,
    show_line_popups = COALESCE($8::boolean, show_line_popups),
    mapbox_access_token = CASE
      WHEN $9::text IS NULL THEN mapbox_access_token
      ELSE $9::text
    END,
    mapbox_access_token_initialized = CASE
      WHEN $9::text IS NULL THEN mapbox_access_token_initialized
      ELSE TRUE
    END,
    large_city_population_threshold = $10::integer,
    large_city_area_km2_threshold = $11::double precision,
    show_geometry_timeline = $12::boolean,
    show_point_geometries = $13::boolean,
    show_line_geometries = $14::boolean,
    show_polygon_geometries = $15::boolean,
    history_start_date = $16::date,
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
    show_geometry_timeline AS "showGeometryTimeline",
    history_start_date::text AS "historyStartDate",
    show_point_geometries AS "showPointGeometries",
    show_line_geometries AS "showLineGeometries",
    show_polygon_geometries AS "showPolygonGeometries",
    large_city_population_threshold::integer AS "largeCityPopulationThreshold",
    large_city_area_km2_threshold::double precision AS "largeCityAreaKm2Threshold",
    public_download_name AS "publicDownloadName",
    (mapbox_access_token IS NOT NULL) AS "mapboxAccessTokenConfigured",
    (city_marker_icon IS NOT NULL) AS "cityMarkerIconConfigured",
    city_marker_icon_width::integer AS "cityMarkerIconWidth",
    city_marker_icon_height::integer AS "cityMarkerIconHeight",
    updated_at AS "updatedAt"
`;

const UPDATE_PUBLIC_DOWNLOAD_NAME_SQL = `
  UPDATE project_settings
  SET
    public_download_name = $1::text,
    updated_at = now()
  WHERE id = 1
  RETURNING
    public_download_name AS "publicDownloadName",
    updated_at AS "updatedAt"
`;

const UPDATE_CITY_MARKER_ICON_SQL = `
  UPDATE project_settings
  SET
    city_marker_icon = $1::bytea,
    city_marker_icon_mime = $2::text,
    city_marker_icon_width = $3::integer,
    city_marker_icon_height = $4::integer,
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
    mapbox_access_token = $1::text,
    mapbox_access_token_initialized = TRUE,
    updated_at = NOW()
  WHERE id = 1
    AND mapbox_access_token_initialized = FALSE
  RETURNING
    (mapbox_access_token IS NOT NULL) AS "mapboxAccessTokenConfigured"
`;

async function listHistorySpeeds(
  queryable,
) {
  const result =
    await queryable.query(
      SELECT_HISTORY_SPEEDS_SQL,
    );
  return result.rows;
}

async function replaceHistorySpeeds(
  queryable,
  speeds,
) {
  if (speeds === null) {
    return;
  }

  await queryable.query(
    DELETE_HISTORY_SPEEDS_SQL,
  );

  for (const speed of speeds) {
    await queryable.query(
      INSERT_HISTORY_SPEED_SQL,
      [
        speed.name,
        speed.stepUnit,
        speed.intervalSeconds,
        speed.sortOrder,
        speed.isActive,
        speed.isDefault,
      ],
    );
  }
}

function requireRow(result) {
  if (!result.rows[0]) {
    throw new Error(
      'Project settings row is missing; run database migrations',
    );
  }
  return result.rows[0];
}

export function createProjectSettingsStorageRepository() {
  return {
    async get(queryable) {
      const settings =
        requireRow(
          await queryable.query(
            SELECT_SETTINGS_SQL,
          ),
        );
      return {
        ...settings,
        historySpeeds:
          await listHistorySpeeds(
            queryable,
          ),
      };
    },

    async getMapboxAccessToken(queryable) {
      const row = requireRow(
        await queryable.query(SELECT_MAPBOX_TOKEN_SQL),
      );
      return row.mapboxAccessToken ?? null;
    },

    async getCityMarkerIcon(queryable) {
      const row = requireRow(
        await queryable.query(SELECT_CITY_MARKER_ICON_SQL),
      );
      if (!row.data) return null;
      return {
        data: row.data,
        mime: row.mime,
        width: row.width,
        height: row.height,
      };
    },

    async getMapboxBootstrapState(queryable) {
      return requireRow(
        await queryable.query(
          SELECT_MAPBOX_BOOTSTRAP_STATE_SQL,
        ),
      );
    },

    async bootstrapMapboxAccessToken(queryable, token) {
      return queryable.query(
        BOOTSTRAP_MAPBOX_TOKEN_SQL,
        [token],
      );
    },

    async updateSettings(queryable, settings) {
      const result = await queryable.query(
        UPDATE_SETTINGS_SQL,
        [
          settings.plan.projectName,
          settings.plan.keywords,
          settings.plan.footerHtml,
          settings.plan.yandexMetrikaId,
          settings.plan.googleAnalyticsId,
          settings.themePreset,
          settings.showLineLabels,
          settings.showLinePopups,
          settings.mapboxAccessToken,
          settings.largeCityPopulationThreshold,
          settings.largeCityAreaKm2Threshold,
          settings.showGeometryTimeline,
          settings.showPointGeometries,
          settings.showLineGeometries,
          settings.showPolygonGeometries,
          settings.historyStartDate,
        ],
      );

      await replaceHistorySpeeds(
        queryable,
        settings.historySpeeds,
      );

      return {
        ...requireRow(result),
        historySpeeds:
          await listHistorySpeeds(
            queryable,
          ),
      };
    },

    async updatePublicDownloadName(queryable, value) {
      return requireRow(
        await queryable.query(
          UPDATE_PUBLIC_DOWNLOAD_NAME_SQL,
          [value],
        ),
      );
    },

    async updateCityMarkerIcon(queryable, icon) {
      return requireRow(
        await queryable.query(
          UPDATE_CITY_MARKER_ICON_SQL,
          [
            icon.data,
            icon.mime,
            icon.width,
            icon.height,
          ],
        ),
      );
    },

    async clearCityMarkerIcon(queryable) {
      return requireRow(
        await queryable.query(CLEAR_CITY_MARKER_ICON_SQL),
      );
    },
  };
}
