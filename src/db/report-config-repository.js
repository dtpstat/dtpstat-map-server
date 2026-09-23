const LOAD_CONFIG_SQL = `
  SELECT
    jsonb_object_agg(config_key, config_value) AS config,
    max(updated_at) AS "updatedAt"
  FROM report_config
  WHERE config_key IN ('metrics', 'table_columns', 'csv_columns', 'rank')
`;

const SAVE_CONFIG_SQL = `
  WITH saved AS (
    INSERT INTO report_config (config_key, config_value, updated_at)
    VALUES
      ('metrics', $1::jsonb, now()),
      ('table_columns', $2::jsonb, now()),
      ('csv_columns', $3::jsonb, now()),
      ('rank', $4::jsonb, now())
    ON CONFLICT (config_key) DO UPDATE SET
      config_value = EXCLUDED.config_value,
      updated_at = now()
    RETURNING updated_at
  )
  SELECT max(updated_at) AS "updatedAt"
  FROM saved
`;

export function createReportConfigRepository() {
  return {
    async load(queryable) {
      const result = await queryable.query(LOAD_CONFIG_SQL);
      return result.rows[0];
    },

    async lineTypeNames(queryable) {
      const result = await queryable.query(
        'SELECT name FROM line_types ORDER BY id',
      );
      return result.rows.map((row) => row.name);
    },

    async save(queryable, config) {
      const result = await queryable.query(SAVE_CONFIG_SQL, [
        JSON.stringify(config.metrics),
        JSON.stringify(config.tableColumns),
        JSON.stringify(config.csvColumns),
        JSON.stringify({ sort: config.rank.sort }),
      ]);
      return result.rows[0]?.updatedAt;
    },
  };
}
