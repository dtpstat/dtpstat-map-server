const CREATE_STREAM_RAW_SQL = `
  CREATE TEMP TABLE population_transfer_raw (
    seq bigint PRIMARY KEY,
    item jsonb NOT NULL
  ) ON COMMIT DROP
`;

const INSERT_STREAM_RAW_SQL = `
  INSERT INTO population_transfer_raw (seq, item)
  SELECT payload.seq, payload.item
  FROM jsonb_to_recordset($1::jsonb) AS payload(
    seq bigint,
    item jsonb
  )
`;

const CREATE_STREAM_STAGE_SQL = `
  CREATE TEMP TABLE population_transfer_stage (
    seq bigint PRIMARY KEY,
    region_name text NOT NULL,
    region_osm_type text,
    region_osm_id bigint,
    region_attributes jsonb NOT NULL,
    city_name text NOT NULL,
    city_osm_type text,
    city_osm_id bigint,
    population integer,
    as_of text,
    source text,
    attributes jsonb NOT NULL,
    CHECK (
      (region_osm_type IS NULL AND region_osm_id IS NULL) OR
      (region_osm_type IN ('way', 'relation') AND region_osm_id > 0)
    ),
    CHECK (
      (city_osm_type IS NULL AND city_osm_id IS NULL) OR
      (city_osm_type IN ('way', 'relation') AND city_osm_id > 0)
    )
  ) ON COMMIT DROP
`;

const INSERT_STREAM_STAGE_SQL = `
  INSERT INTO population_transfer_stage (
    seq,
    region_name,
    region_osm_type,
    region_osm_id,
    region_attributes,
    city_name,
    city_osm_type,
    city_osm_id,
    population,
    as_of,
    source,
    attributes
  )
  SELECT
    payload.seq,
    payload."regionName",
    payload."regionOsmType",
    payload."regionOsmId",
    payload."regionAttributes",
    payload."cityName",
    payload."cityOsmType",
    payload."cityOsmId",
    payload.population,
    payload."asOf",
    payload.source,
    payload.attributes
  FROM jsonb_to_recordset($1::jsonb) AS payload(
    seq bigint,
    "regionName" text,
    "regionOsmType" text,
    "regionOsmId" bigint,
    "regionAttributes" jsonb,
    "cityName" text,
    "cityOsmType" text,
    "cityOsmId" bigint,
    population integer,
    "asOf" text,
    source text,
    attributes jsonb
  )
`;

const NORMALIZE_NAME_SQL = (expression) => `
  regexp_replace(
    lower(translate(trim(COALESCE(${expression}, '')), 'Ёё', 'Ее')),
    '[^0-9a-zа-я]+',
    '',
    'g'
  )
`;

const BOUNDARY_NAME_MATCH_SQL = (
  boundaryAlias,
  keyExpression,
  extraAliases = [],
) => {
  const aliases = [
    `${boundaryAlias}.display_name`,
    `${boundaryAlias}.osm_name`,
    `${boundaryAlias}.tags ->> 'name:ru'`,
    `${boundaryAlias}.tags ->> 'name'`,
    `${boundaryAlias}.tags ->> 'official_name:ru'`,
    `${boundaryAlias}.tags ->> 'official_name'`,
    `${boundaryAlias}.tags ->> 'short_name:ru'`,
    `${boundaryAlias}.tags ->> 'short_name'`,
    `${boundaryAlias}.tags ->> 'loc_name:ru'`,
    `${boundaryAlias}.tags ->> 'loc_name'`,
    ...extraAliases,
  ];

  return `
    EXISTS (
      SELECT 1
      FROM unnest(
        ARRAY[${aliases.join(', ')}] ||
        string_to_array(
          COALESCE(${boundaryAlias}.tags ->> 'alt_name:ru', ''),
          ';'
        ) ||
        string_to_array(
          COALESCE(${boundaryAlias}.tags ->> 'alt_name', ''),
          ';'
        )
      ) AS boundary_alias(value)
      WHERE ${NORMALIZE_NAME_SQL('boundary_alias.value')} =
            ${keyExpression}
    )
  `;
};

const RESOLVE_STAGE_SQL = `
  CREATE TEMP TABLE population_transfer_resolved
  ON COMMIT DROP
  AS
  WITH RECURSIVE
  stage_regions AS (
    SELECT DISTINCT
      stage.region_name,
      stage.region_osm_type,
      stage.region_osm_id,
      ${NORMALIZE_NAME_SQL('stage.region_name')} AS region_key
    FROM population_transfer_stage AS stage
  ),
  region_candidates AS (
    SELECT
      stage_region.region_name,
      stage_region.region_osm_type,
      stage_region.region_osm_id,
      boundary.id AS region_id,
      CASE
        WHEN stage_region.region_osm_type IS NOT NULL THEN 0
        WHEN boundary.tags ? 'ISO3166-2' THEN 0
        ELSE 1
      END AS canonical_rank,
      CASE
        WHEN ${NORMALIZE_NAME_SQL('boundary.display_name')} =
             stage_region.region_key
        THEN 0
        ELSE 1
      END AS display_rank
    FROM stage_regions AS stage_region
    JOIN city_boundaries AS boundary
      ON boundary.admin_level = 4
     AND (
       (
         stage_region.region_osm_type IS NOT NULL
         AND stage_region.region_osm_id IS NOT NULL
         AND boundary.osm_type = stage_region.region_osm_type
         AND boundary.osm_id = stage_region.region_osm_id
       )
       OR
       (
         stage_region.region_osm_type IS NULL
         AND stage_region.region_osm_id IS NULL
         AND ${BOUNDARY_NAME_MATCH_SQL(
           'boundary',
           'stage_region.region_key',
         )}
       )
     )
  ),
  region_ranked AS (
    SELECT
      region_candidate.*,
      DENSE_RANK() OVER (
        PARTITION BY
          region_candidate.region_name,
          region_candidate.region_osm_type,
          region_candidate.region_osm_id
        ORDER BY
          region_candidate.canonical_rank,
          region_candidate.display_rank
      ) AS preference_rank
    FROM region_candidates AS region_candidate
  ),
  region_counts AS (
    SELECT
      stage_region.region_name,
      stage_region.region_osm_type,
      stage_region.region_osm_id,
      COUNT(region_ranked.region_id)
        FILTER (WHERE region_ranked.preference_rank = 1)::integer
        AS match_count,
      MIN(region_ranked.region_id)
        FILTER (WHERE region_ranked.preference_rank = 1)
        AS region_id
    FROM stage_regions AS stage_region
    LEFT JOIN region_ranked
      ON region_ranked.region_name = stage_region.region_name
     AND region_ranked.region_osm_type IS NOT DISTINCT FROM
         stage_region.region_osm_type
     AND region_ranked.region_osm_id IS NOT DISTINCT FROM
         stage_region.region_osm_id
    GROUP BY
      stage_region.region_name,
      stage_region.region_osm_type,
      stage_region.region_osm_id
  ),
  descendants AS (
    SELECT
      region_count.region_name,
      region_count.region_osm_type,
      region_count.region_osm_id,
      region_count.region_id,
      region_count.region_id AS boundary_id
    FROM region_counts AS region_count
    WHERE region_count.match_count = 1

    UNION ALL

    SELECT
      parent.region_name,
      parent.region_osm_type,
      parent.region_osm_id,
      parent.region_id,
      child.id
    FROM descendants AS parent
    JOIN city_boundaries AS child
      ON child.parent_id = parent.boundary_id
  ),
  city_candidates AS (
    SELECT
      stage.seq,
      boundary.id AS boundary_id,
      CASE
        WHEN stage.city_osm_type IS NOT NULL THEN 0
        ELSE 1
      END AS identity_rank,
      CASE
        WHEN boundary.city_id IS NOT NULL THEN 0
        ELSE 1
      END AS linked_city_rank,
      CASE
        WHEN boundary.is_active THEN 0
        ELSE 1
      END AS active_rank,
      CASE
        WHEN ${NORMALIZE_NAME_SQL('boundary.display_name')} =
             ${NORMALIZE_NAME_SQL('stage.city_name')}
        THEN 0
        ELSE 1
      END AS display_rank
    FROM population_transfer_stage AS stage
    JOIN region_counts AS region_count
      ON region_count.region_name = stage.region_name
     AND region_count.region_osm_type IS NOT DISTINCT FROM stage.region_osm_type
     AND region_count.region_osm_id IS NOT DISTINCT FROM stage.region_osm_id
     AND region_count.match_count = 1
    JOIN descendants AS descendant
      ON descendant.region_name = stage.region_name
     AND descendant.region_osm_type IS NOT DISTINCT FROM stage.region_osm_type
     AND descendant.region_osm_id IS NOT DISTINCT FROM stage.region_osm_id
     AND descendant.region_id = region_count.region_id
    JOIN city_boundaries AS boundary
      ON boundary.id = descendant.boundary_id
    LEFT JOIN cities AS application_city
      ON application_city.id = boundary.city_id
    WHERE
      (
        boundary.place_type IN ('city', 'town')
        OR boundary.city_id IS NOT NULL
      )
      AND (
        (
          stage.city_osm_type IS NOT NULL
          AND stage.city_osm_id IS NOT NULL
          AND boundary.osm_type = stage.city_osm_type
          AND boundary.osm_id = stage.city_osm_id
        )
        OR
        (
          stage.city_osm_type IS NULL
          AND stage.city_osm_id IS NULL
          AND ${BOUNDARY_NAME_MATCH_SQL(
            'boundary',
            NORMALIZE_NAME_SQL('stage.city_name'),
            [
              'application_city.name',
              'application_city.full_name',
            ],
          )}
        )
      )
  ),
  city_ranked AS (
    SELECT
      city_candidate.*,
      DENSE_RANK() OVER (
        PARTITION BY city_candidate.seq
        ORDER BY
          city_candidate.identity_rank,
          city_candidate.linked_city_rank,
          city_candidate.active_rank,
          city_candidate.display_rank
      ) AS preference_rank
    FROM city_candidates AS city_candidate
  ),
  city_counts AS (
    SELECT
      stage.seq,
      COUNT(city_ranked.boundary_id)
        FILTER (WHERE city_ranked.preference_rank = 1)::integer
        AS match_count,
      MIN(city_ranked.boundary_id)
        FILTER (WHERE city_ranked.preference_rank = 1)
        AS boundary_id
    FROM population_transfer_stage AS stage
    LEFT JOIN city_ranked
      ON city_ranked.seq = stage.seq
    GROUP BY stage.seq
  ),
  base_resolution AS (
    SELECT
      stage.seq,
      stage.region_name,
      stage.city_name,
      region_count.region_id,
      city_count.boundary_id,
      CASE
        WHEN region_count.match_count = 0 THEN 'region-missing'
        WHEN region_count.match_count > 1 THEN 'region-ambiguous'
        WHEN city_count.match_count = 0 THEN 'city-missing'
        WHEN city_count.match_count > 1 THEN 'city-ambiguous'
        ELSE 'matched'
      END AS status
    FROM population_transfer_stage AS stage
    JOIN region_counts AS region_count
      ON region_count.region_name = stage.region_name
     AND region_count.region_osm_type IS NOT DISTINCT FROM stage.region_osm_type
     AND region_count.region_osm_id IS NOT DISTINCT FROM stage.region_osm_id
    JOIN city_counts AS city_count
      ON city_count.seq = stage.seq
  ),
  ranked AS (
    SELECT
      base_resolution.*,
      CASE
        WHEN base_resolution.status = 'matched'
        THEN ROW_NUMBER() OVER (
          PARTITION BY base_resolution.boundary_id
          ORDER BY base_resolution.seq
        )
        ELSE 1
      END AS target_rank
    FROM base_resolution
  )
  SELECT
    ranked.seq,
    ranked.region_name,
    ranked.city_name,
    ranked.region_id,
    ranked.boundary_id,
    CASE
      WHEN ranked.status = 'matched' AND ranked.target_rank > 1
      THEN 'city-duplicate-target'
      ELSE ranked.status
    END AS status
  FROM ranked
`;

const RESOLUTION_STATUS_SQL = `
  SELECT
    resolved.seq,
    resolved.region_name AS "regionName",
    resolved.city_name AS "cityName",
    resolved.status
  FROM population_transfer_resolved AS resolved
  ORDER BY resolved.seq
`;

const UPDATE_REGIONS_SQL = `
  UPDATE city_boundaries AS boundary
  SET attributes = source.region_attributes,
      updated_at = now()
  FROM (
    SELECT DISTINCT ON (resolved.region_id)
      resolved.region_id,
      stage.region_attributes
    FROM population_transfer_stage AS stage
    JOIN population_transfer_resolved AS resolved
      ON resolved.seq = stage.seq
    WHERE resolved.region_id IS NOT NULL
      AND resolved.status NOT IN ('region-missing', 'region-ambiguous')
    ORDER BY resolved.region_id, stage.seq
  ) AS source
  WHERE boundary.id = source.region_id
  RETURNING boundary.id
`;

const UPDATE_CITIES_SQL = `
  UPDATE city_boundaries AS boundary
  SET population = stage.population,
      population_as_of = stage.as_of::date,
      population_source = stage.source,
      attributes = stage.attributes,
      updated_at = now()
  FROM population_transfer_stage AS stage
  JOIN population_transfer_resolved AS resolved
    ON resolved.seq = stage.seq
   AND resolved.status = 'matched'
  WHERE boundary.id = resolved.boundary_id
  RETURNING boundary.id
`;

export function createPopulationImportRepository() {
  return {
    createRawStage(client) {
      return client.query(CREATE_STREAM_RAW_SQL);
    },

    insertRawBatch(client, batch) {
      return client.query(
        INSERT_STREAM_RAW_SQL,
        [JSON.stringify(batch)],
      );
    },

    readRawBatch(client, lastRegionSeq, limit) {
      return client.query(
        `SELECT seq::text AS seq, item
         FROM population_transfer_raw
         WHERE seq > $1::bigint
         ORDER BY population_transfer_raw.seq
         LIMIT $2`,
        [lastRegionSeq, limit],
      );
    },

    createStage(client) {
      return client.query(CREATE_STREAM_STAGE_SQL);
    },

    async insertStageBatch(client, rows, startSeq = 0) {
      if (rows.length === 0) return 0;
      const payload = rows.map((row, index) => ({
        seq: startSeq + index,
        ...row,
      }));
      const inserted = await client.query(
        INSERT_STREAM_STAGE_SQL,
        [JSON.stringify(payload)],
      );
      if (inserted.rowCount !== payload.length) {
        throw new Error(
          'Not every normalized population city was staged',
        );
      }
      return inserted.rowCount;
    },

    resolveStage(client) {
      return client.query(RESOLVE_STAGE_SQL);
    },

    resolutionStatus(client) {
      return client.query(RESOLUTION_STATUS_SQL);
    },

    updateRegions(client) {
      return client.query(UPDATE_REGIONS_SQL);
    },

    updateCities(client) {
      return client.query(UPDATE_CITIES_SQL);
    },

    syncActiveBoundaryPopulations(client) {
      return client.query('SELECT sync_active_boundary_populations()');
    },
  };
}
