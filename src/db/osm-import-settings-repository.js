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
    max_bytes::bigint::text AS "maxBytes",
    max_retries::integer AS "maxRetries",
    retry_base_delay_ms::integer AS "retryBaseDelayMs",
    retry_max_delay_ms::integer AS "retryMaxDelayMs",
    updated_at AS "updatedAt"
  FROM osm_import_settings
  WHERE id = 1
`;

const UPDATE_SQL = `
  UPDATE osm_import_settings
  SET source_url = $1,
      include_city = $2,
      include_town = $3,
      include_administrative = $4,
      admin_level_min = $5,
      admin_level_max = $6,
      batch_size = $7,
      min_delay_ms = $8,
      timeout_ms = $9,
      query_timeout_seconds = $10,
      max_bytes = $11,
      max_retries = $12,
      retry_base_delay_ms = $13,
      retry_max_delay_ms = $14,
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
    max_bytes::bigint::text AS "maxBytes",
    max_retries::integer AS "maxRetries",
    retry_base_delay_ms::integer AS "retryBaseDelayMs",
    retry_max_delay_ms::integer AS "retryMaxDelayMs",
    updated_at AS "updatedAt"
`;

function row(settings) {
  if (!settings) throw new Error('OSM import settings are missing; run database migrations');
  return {
    ...settings,
    maxBytes: Number(settings.maxBytes),
    updatedAt: settings.updatedAt instanceof Date
      ? settings.updatedAt.toISOString()
      : settings.updatedAt,
  };
}

/** @param {{ query: Function }} database */
export function createOsmImportSettingsRepository(database) {
  return {
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
        settings.maxBytes,
        settings.maxRetries,
        settings.retryBaseDelayMs,
        settings.retryMaxDelayMs,
      ]);
      return row(result.rows[0]);
    },
  };
}
