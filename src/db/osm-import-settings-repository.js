const SELECT_SQL = `
  SELECT
    source_url AS "sourceURL",
    include_city AS "includeCity",
    include_town AS "includeTown",
    include_administrative AS "includeAdministrative",
    admin_level_min::integer AS "adminLevelMin",
    admin_level_max::integer AS "adminLevelMax",
    batch_size::integer AS "batchSize",
    min_delay_ms::integer AS "minDelayMs",
    timeout_ms::integer AS "timeoutMs",
    query_timeout_seconds::integer AS "queryTimeoutSeconds",
    max_response_bytes::bigint::text AS "maxResponseBytes",
    max_total_bytes::bigint::text AS "maxTotalBytes",
    max_retries::integer AS "maxRetries",
    retry_base_delay_ms::integer AS "retryBaseDelayMs",
    retry_max_delay_ms::integer AS "retryMaxDelayMs",
    initialized,
    updated_at AS "updatedAt"
  FROM osm_import_settings
  WHERE id = 1
`;

const UPDATE_SQL = `
  UPDATE osm_import_settings
  SET source_url = $1::text,
      include_city = $2::boolean,
      include_town = $3::boolean,
      include_administrative = $4::boolean,
      admin_level_min = $5::smallint,
      admin_level_max = $6::smallint,
      batch_size = $7::integer,
      min_delay_ms = $8::integer,
      timeout_ms = $9::integer,
      query_timeout_seconds = $10::integer,
      max_response_bytes = $11::bigint,
      max_total_bytes = $12::bigint,
      max_retries = $13::integer,
      retry_base_delay_ms = $14::integer,
      retry_max_delay_ms = $15::integer,
      initialized = TRUE,
      updated_at = now()
  WHERE id = 1
  RETURNING
    source_url AS "sourceURL",
    include_city AS "includeCity",
    include_town AS "includeTown",
    include_administrative AS "includeAdministrative",
    admin_level_min::integer AS "adminLevelMin",
    admin_level_max::integer AS "adminLevelMax",
    batch_size::integer AS "batchSize",
    min_delay_ms::integer AS "minDelayMs",
    timeout_ms::integer AS "timeoutMs",
    query_timeout_seconds::integer AS "queryTimeoutSeconds",
    max_response_bytes::bigint::text AS "maxResponseBytes",
    max_total_bytes::bigint::text AS "maxTotalBytes",
    max_retries::integer AS "maxRetries",
    retry_base_delay_ms::integer AS "retryBaseDelayMs",
    retry_max_delay_ms::integer AS "retryMaxDelayMs",
    initialized,
    updated_at AS "updatedAt"
`;

const BOOTSTRAP_SQL = `
  UPDATE osm_import_settings
  SET source_url = $1::text,
      include_city = TRUE,
      include_town = TRUE,
      include_administrative = TRUE,
      admin_level_min = 4,
      admin_level_max = 8,
      batch_size = $2::integer,
      min_delay_ms = $3::integer,
      timeout_ms = $4::integer,
      query_timeout_seconds = $5::integer,
      max_response_bytes = $6::bigint,
      max_total_bytes = $7::bigint,
      max_retries = $8::integer,
      retry_base_delay_ms = $9::integer,
      retry_max_delay_ms = $10::integer,
      initialized = TRUE,
      updated_at = now()
  WHERE id = 1
    AND initialized = FALSE
  RETURNING id
`;

function row(settings) {
  if (!settings) throw new Error('OSM import settings are missing; run database migrations');
  return {
    ...settings,
    maxResponseBytes: Number(settings.maxResponseBytes),
    maxTotalBytes: Number(settings.maxTotalBytes),
    initialized: Boolean(settings.initialized),
    updatedAt: settings.updatedAt instanceof Date
      ? settings.updatedAt.toISOString()
      : settings.updatedAt,
  };
}

/** @param {{ query: Function }} database */
export function createOsmImportSettingsRepository(database) {
  return {
    async bootstrap(config) {
      const result = await database.query(BOOTSTRAP_SQL, [
        config.url,
        config.batchSize,
        config.minDelayMs,
        config.timeoutMs,
        config.queryTimeoutSeconds,
        config.maxResponseBytes,
        config.maxTotalBytes,
        config.maxRetries,
        config.retryBaseDelayMs,
        config.retryMaxDelayMs,
      ]);
      return { initialized: result.rowCount > 0 };
    },

    async get() {
      const result = await database.query(SELECT_SQL);
      return row(result.rows[0]);
    },

    async save(settings) {
      const result = await database.query(UPDATE_SQL, [
        settings.sourceURL,
        settings.includeCity,
        settings.includeTown,
        settings.includeAdministrative,
        settings.adminLevelMin,
        settings.adminLevelMax,
        settings.batchSize,
        settings.minDelayMs,
        settings.timeoutMs,
        settings.queryTimeoutSeconds,
        settings.maxResponseBytes,
        settings.maxTotalBytes,
        settings.maxRetries,
        settings.retryBaseDelayMs,
        settings.retryMaxDelayMs,
      ]);
      return row(result.rows[0]);
    },
  };
}
