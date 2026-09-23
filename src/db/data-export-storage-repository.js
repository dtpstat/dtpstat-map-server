const EXPORT_CITY_BOUNDARIES_SQL = `
  SELECT json_build_object(
    'type', 'FeatureCollection',
    'name', 'dtpstat-buslines-cities',
    'schemaVersion', 2,
    'exportedAt', now(),
    'features', COALESCE(
      json_agg(
        json_build_object(
          'type', 'Feature',
          'geometry', ST_AsGeoJSON(boundary.geom)::json,
          'properties', jsonb_build_object(
            'placeType', boundary.place_type,
            'adminLevel', boundary.admin_level,
            'active', boundary.is_active,
            'displayName', boundary.display_name,
            'displayType', boundary.display_type,
            'osmType', boundary.osm_type,
            'osmId', boundary.osm_id,
            'osmName', boundary.osm_name,
            'population', boundary.population,
            'populationAsOf', boundary.population_as_of,
            'populationSource', boundary.population_source,
            'attributes', boundary.attributes,
            'tags', boundary.tags,
            'osmTimestamp', boundary.osm_timestamp,
            'updatedAt', boundary.updated_at,
            'citySlug', city.slug,
            'cityName', city.name,
            'city', CASE
              WHEN city.id IS NULL THEN NULL
              ELSE jsonb_build_object(
                'slug', city.slug,
                'name', city.name,
                'fullName', city.full_name,
                'displayType', city.display_type,
                'attributes', city.attributes
              )
            END
          )
        )
        ORDER BY boundary.place_type, boundary.osm_name,
                 boundary.osm_type, boundary.osm_id
      ),
      '[]'::json
    )
  ) AS payload
  FROM city_boundaries AS boundary
  LEFT JOIN cities AS city ON city.id = boundary.city_id
`;

const EXPORT_LINES_SQL = `
  SELECT json_build_object(
    'type', 'FeatureCollection',
    'name', 'dtpstat-buslines-lines',
    'schemaVersion', 3,
    'exportedAt', now(),
    'lineTypes', COALESCE(
      (
        SELECT json_agg(
          json_build_object(
            'code', line_type.code,
            'name', line_type.name,
            'title', line_type.title,
            'color', line_type.color,
            'style', line_type.line_style,
            'width', line_type.width
          )
          ORDER BY line_type.code
        )
        FROM line_types AS line_type
      ),
      '[]'::json
    ),
    'features', COALESCE(
      json_agg(
        json_build_object(
          'type', 'Feature',
          'geometry', ST_AsGeoJSON(geometry.geom)::json,
          'properties', geometry.properties || jsonb_strip_nulls(
            jsonb_build_object(
              'short_name', city.name,
              'name', COALESCE(city.full_name, city.name),
              'lanes', geometry.lanes,
              'length', geometry.length_m,
              'lanes_length', geometry.lane_length_m,
              '_dtpstat', jsonb_strip_nulls(
                jsonb_build_object(
                  'citySlug', city.slug,
                  'boundaryOsmType', boundary.osm_type,
                  'boundaryOsmId', boundary.osm_id,
                  'businessTypeCode', line_type.code
                )
              )
            )
          )
        )
        ORDER BY geometry.id
      ),
      '[]'::json
    )
  ) AS payload
  FROM city_geometries AS geometry
  JOIN city_boundaries AS boundary
    ON boundary.id = geometry.boundary_id
   AND boundary.is_active
  JOIN line_types AS line_type ON line_type.id = geometry.line_type_id
  LEFT JOIN cities AS city ON city.id = geometry.city_id
`;

const STREAM_CITY_BOUNDARIES_SQL = `
  SELECT json_build_object(
    'type', 'Feature',
    'geometry', ST_AsGeoJSON(boundary.geom)::json,
    'properties', jsonb_build_object(
      'placeType', boundary.place_type,
      'adminLevel', boundary.admin_level,
      'active', boundary.is_active,
      'displayName', boundary.display_name,
      'displayType', boundary.display_type,
      'osmType', boundary.osm_type,
      'osmId', boundary.osm_id,
      'osmName', boundary.osm_name,
      'population', boundary.population,
      'populationAsOf', boundary.population_as_of,
      'populationSource', boundary.population_source,
      'attributes', boundary.attributes,
      'tags', boundary.tags,
      'osmTimestamp', boundary.osm_timestamp,
      'updatedAt', boundary.updated_at,
      'citySlug', city.slug,
      'cityName', city.name,
      'city', CASE
        WHEN city.id IS NULL THEN NULL
        ELSE jsonb_build_object(
          'slug', city.slug,
          'name', city.name,
          'fullName', city.full_name,
          'displayType', city.display_type,
          'attributes', city.attributes
        )
      END
    )
  )::text AS item
  FROM city_boundaries AS boundary
  LEFT JOIN cities AS city ON city.id = boundary.city_id
  ORDER BY boundary.place_type, boundary.osm_name,
           boundary.osm_type, boundary.osm_id
`;

const STREAM_LINE_TYPES_SQL = `
  SELECT json_build_object(
    'code', line_type.code,
    'name', line_type.name,
    'title', line_type.title,
    'color', line_type.color,
    'style', line_type.line_style,
    'width', line_type.width
  )::text AS item
  FROM line_types AS line_type
  ORDER BY line_type.code
`;

const STREAM_LINES_SQL = `
  SELECT json_build_object(
    'type', 'Feature',
    'geometry', ST_AsGeoJSON(geometry.geom)::json,
    'properties', geometry.properties || jsonb_strip_nulls(
      jsonb_build_object(
        'short_name', city.name,
        'name', COALESCE(city.full_name, city.name),
        'lanes', geometry.lanes,
        'length', geometry.length_m,
        'lanes_length', geometry.lane_length_m,
        '_dtpstat', jsonb_strip_nulls(
          jsonb_build_object(
            'citySlug', city.slug,
            'boundaryOsmType', boundary.osm_type,
            'boundaryOsmId', boundary.osm_id,
            'businessTypeCode', line_type.code
          )
        )
      )
    )
  )::text AS item
  FROM city_geometries AS geometry
  JOIN city_boundaries AS boundary
    ON boundary.id = geometry.boundary_id
   AND boundary.is_active
  JOIN line_types AS line_type ON line_type.id = geometry.line_type_id
  LEFT JOIN cities AS city ON city.id = geometry.city_id
  ORDER BY geometry.id
`;

const POPULATION_REGIONS_SQL = `
  WITH RECURSIVE ancestry AS (
    SELECT
      city.id AS city_id,
      city.id AS boundary_id,
      0::integer AS depth
    FROM city_boundaries AS city
    WHERE city.place_type IN ('city', 'town')

    UNION ALL

    SELECT
      ancestry.city_id,
      parent.id AS boundary_id,
      ancestry.depth + 1
    FROM ancestry
    JOIN city_boundaries AS current
      ON current.id = ancestry.boundary_id
    JOIN city_boundaries AS parent
      ON parent.id = current.parent_id
  ),
  city_regions AS (
    SELECT DISTINCT ON (ancestry.city_id)
      ancestry.city_id,
      region.id AS region_id
    FROM ancestry
    JOIN city_boundaries AS region
      ON region.id = ancestry.boundary_id
     AND region.admin_level = 4
    ORDER BY ancestry.city_id, ancestry.depth
  )
  SELECT
    region.id::integer AS "regionId",
    region.display_name AS "regionName",
    region.osm_type AS "regionOsmType",
    region.osm_id::text AS "regionOsmId",
    region.attributes AS "regionAttributes",
    city.id::integer AS "cityId",
    city.display_name AS "cityName",
    city.osm_type AS "cityOsmType",
    city.osm_id::text AS "cityOsmId",
    city.population::integer AS population,
    city.population_as_of AS "asOf",
    city.population_source AS source,
    city.attributes
  FROM city_regions AS link
  JOIN city_boundaries AS region
    ON region.id = link.region_id
  JOIN city_boundaries AS city
    ON city.id = link.city_id
  ORDER BY
    region.display_name,
    region.id,
    city.display_name,
    city.id
`;

async function* cursorRows(client, cursorName, sql, fetchSize = 100) {
  await client.query(
    `DECLARE ${cursorName} NO SCROLL CURSOR FOR ${sql}`,
  );
  try {
    for (;;) {
      const result = await client.query(
        `FETCH FORWARD ${fetchSize} FROM ${cursorName}`,
      );
      if (result.rows.length === 0) break;
      for (const row of result.rows) yield row;
    }
  } finally {
    await client.query(`CLOSE ${cursorName}`).catch(() => {});
  }
}

async function* cursorItems(client, cursorName, sql, fetchSize = 100) {
  for await (const row of cursorRows(client, cursorName, sql, fetchSize)) {
    yield row.item;
  }
}

async function* jsonArray(items) {
  let first = true;
  for await (const item of items) {
    if (!first) yield ',';
    first = false;
    yield item;
  }
}

export function createDataExportStorageRepository() {
  async function payload(queryable, sql) {
    const result = await queryable.query(sql);
    return result.rows[0]?.payload;
  }

  return {
    exportCityBoundaries(queryable) {
      return payload(queryable, EXPORT_CITY_BOUNDARIES_SQL);
    },

    exportLines(queryable) {
      return payload(queryable, EXPORT_LINES_SQL);
    },

    async exportedAt(queryable) {
      const result = await queryable.query(
        'SELECT now() AS "exportedAt"',
      );
      return result.rows[0]?.exportedAt ?? new Date();
    },

    async lineTypeItems(queryable) {
      const result = await queryable.query(STREAM_LINE_TYPES_SQL);
      return result.rows.map((row) => row.item);
    },

    populationRows(queryable) {
      return queryable.query(POPULATION_REGIONS_SQL);
    },

    streamCityBoundaryItems(client, fetchSize = 100) {
      return cursorItems(
        client,
        'portable_city_export',
        STREAM_CITY_BOUNDARIES_SQL,
        fetchSize,
      );
    },

    streamLineItems(client, fetchSize = 100) {
      return cursorItems(
        client,
        'portable_line_export',
        STREAM_LINES_SQL,
        fetchSize,
      );
    },

    streamPopulationRows(client, fetchSize = 100) {
      return cursorRows(
        client,
        'portable_population_export',
        POPULATION_REGIONS_SQL,
        fetchSize,
      );
    },
  };
}
