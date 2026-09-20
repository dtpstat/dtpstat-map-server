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
        ORDER BY boundary.place_type, boundary.osm_name, boundary.osm_type, boundary.osm_id
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
  LEFT JOIN city_boundaries AS boundary
    ON boundary.id = geometry.boundary_id
  JOIN line_types AS line_type ON line_type.id = geometry.line_type_id
  LEFT JOIN cities AS city ON city.id = geometry.city_id
  WHERE GeometryType(geometry.geom) IN ('LINESTRING', 'MULTILINESTRING')
`;

const EXPORT_GEOMETRIES_SQL = `
  SELECT json_build_object(
    'type', 'FeatureCollection',
    'name', 'dtpstat-project-geometries',
    'schemaVersion', 4,
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
          'id', geometry.id,
          'geometry', ST_AsGeoJSON(geometry.geom)::json,
          'properties', geometry.properties || jsonb_strip_nulls(
            jsonb_build_object(
              'geometryFamily', CASE
                WHEN GeometryType(geometry.geom) = 'POINT' THEN 'point'
                WHEN GeometryType(geometry.geom) IN ('LINESTRING', 'MULTILINESTRING') THEN 'line'
                WHEN GeometryType(geometry.geom) IN ('POLYGON', 'MULTIPOLYGON') THEN 'polygon'
              END,
              'displayName', geometry.display_name,
              'tooltip', geometry.tooltip,
              'tags', geometry.tags,
              'sourceTags', geometry.source_tags,
              'isVisible', geometry.is_visible,
              'wasEdited', geometry.was_edited,
              'lanes', geometry.lanes,
              'length', geometry.length_m,
              'lanes_length', geometry.lane_length_m,
              '_dtpstat', jsonb_strip_nulls(
                jsonb_build_object(
                  'citySlug', city.slug,
                  'boundaryOsmType', boundary.osm_type,
                  'boundaryOsmId', boundary.osm_id,
                  'businessTypeCode', line_type.code,
                  'createdAt', geometry.created_at,
                  'updatedAt', geometry.updated_at
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
  JOIN cities AS city ON city.id = geometry.city_id
  LEFT JOIN city_boundaries AS boundary ON boundary.id = geometry.boundary_id
  LEFT JOIN line_types AS line_type ON line_type.id = geometry.line_type_id
`;

const EXPORT_POPULATIONS_SQL = `
  SELECT json_build_object(
    'schemaVersion', 1,
    'exportedAt', now(),
    'populations', COALESCE(
      json_agg(
        json_build_object(
          'name', city.name,
          'type', city.display_type,
          'citySlug', city.slug,
          'population', population.population,
          'asOf', population.as_of,
          'source', population.source,
          'attributes', population.attributes
        )
        ORDER BY city.name
      ),
      '[]'::json
    )
  ) AS payload
  FROM city_populations AS population
  JOIN cities AS city ON city.id = population.city_id
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
  LEFT JOIN city_boundaries AS boundary
    ON boundary.id = geometry.boundary_id
  JOIN line_types AS line_type ON line_type.id = geometry.line_type_id
  LEFT JOIN cities AS city ON city.id = geometry.city_id
  WHERE GeometryType(geometry.geom) IN ('LINESTRING', 'MULTILINESTRING')
  ORDER BY geometry.id
`;

const STREAM_GEOMETRIES_SQL = `
  SELECT json_build_object(
    'type', 'Feature',
    'id', geometry.id,
    'geometry', ST_AsGeoJSON(geometry.geom)::json,
    'properties', geometry.properties || jsonb_strip_nulls(
      jsonb_build_object(
        'geometryFamily', CASE
          WHEN GeometryType(geometry.geom) = 'POINT' THEN 'point'
          WHEN GeometryType(geometry.geom) IN ('LINESTRING', 'MULTILINESTRING') THEN 'line'
          WHEN GeometryType(geometry.geom) IN ('POLYGON', 'MULTIPOLYGON') THEN 'polygon'
        END,
        'displayName', geometry.display_name,
        'tooltip', geometry.tooltip,
        'tags', geometry.tags,
        'sourceTags', geometry.source_tags,
        'isVisible', geometry.is_visible,
        'wasEdited', geometry.was_edited,
        'lanes', geometry.lanes,
        'length', geometry.length_m,
        'lanes_length', geometry.lane_length_m,
        '_dtpstat', jsonb_strip_nulls(
          jsonb_build_object(
            'citySlug', city.slug,
            'boundaryOsmType', boundary.osm_type,
            'boundaryOsmId', boundary.osm_id,
            'businessTypeCode', line_type.code,
            'createdAt', geometry.created_at,
            'updatedAt', geometry.updated_at
          )
        )
      )
    )
  )::text AS item
  FROM city_geometries AS geometry
  JOIN cities AS city ON city.id = geometry.city_id
  LEFT JOIN city_boundaries AS boundary ON boundary.id = geometry.boundary_id
  LEFT JOIN line_types AS line_type ON line_type.id = geometry.line_type_id
  ORDER BY geometry.id
`;

const STREAM_POPULATIONS_SQL = `
  SELECT json_build_object(
    'name', city.name,
    'type', city.display_type,
    'citySlug', city.slug,
    'population', population.population,
    'asOf', population.as_of,
    'source', population.source,
    'attributes', population.attributes
  )::text AS item
  FROM city_populations AS population
  JOIN cities AS city ON city.id = population.city_id
  ORDER BY city.name
`;

async function* cursorItems(client, cursorName, sql, fetchSize = 100) {
  await client.query(
    `DECLARE ${cursorName} NO SCROLL CURSOR FOR ${sql}`,
  );
  try {
    for (;;) {
      const result = await client.query(
        `FETCH FORWARD ${fetchSize} FROM ${cursorName}`,
      );
      if (result.rows.length === 0) break;
      for (const row of result.rows) yield row.item;
    }
  } finally {
    await client.query(`CLOSE ${cursorName}`).catch(() => {});
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

/**
 * Read-only portable snapshots used for backup, transfer and synchronization.
 * @param {{ query: (text: string, values?: unknown[]) => Promise<{rows: any[]}> }} database
 */
export function createDataExportRepository(database) {
  async function payload(sql) {
    const result = await database.query(sql);
    return result.rows[0]?.payload;
  }

  return {
    async *streamCityBoundaries() {
      if (typeof database.connect !== 'function') {
        yield JSON.stringify(await payload(EXPORT_CITY_BOUNDARIES_SQL));
        yield '\n';
        return;
      }
      const client = await database.connect();
      try {
        await client.query('BEGIN READ ONLY');
        const timestamp = await client.query(
          'SELECT now() AS "exportedAt"',
        );
        yield '{"type":"FeatureCollection","name":"dtpstat-buslines-cities","schemaVersion":2,"exportedAt":';
        yield JSON.stringify(timestamp.rows[0]?.exportedAt ?? new Date());
        yield ',"features":[';
        yield* jsonArray(
          cursorItems(
            client,
            'portable_city_export',
            STREAM_CITY_BOUNDARIES_SQL,
          ),
        );
        yield ']}\n';
      } finally {
        await client.query('ROLLBACK').catch(() => {});
        client.release();
      }
    },

    async *streamLines() {
      if (typeof database.connect !== 'function') {
        yield JSON.stringify(await payload(EXPORT_LINES_SQL));
        yield '\n';
        return;
      }
      const client = await database.connect();
      try {
        await client.query('BEGIN READ ONLY');
        const timestamp = await client.query(
          'SELECT now() AS "exportedAt"',
        );
        yield '{"type":"FeatureCollection","name":"dtpstat-buslines-lines","schemaVersion":3,"exportedAt":';
        yield JSON.stringify(timestamp.rows[0]?.exportedAt ?? new Date());
        yield ',"lineTypes":[';
        const lineTypes = await client.query(STREAM_LINE_TYPES_SQL);
        let firstType = true;
        for (const row of lineTypes.rows) {
          if (!firstType) yield ',';
          firstType = false;
          yield row.item;
        }
        yield '],"features":[';
        yield* jsonArray(
          cursorItems(client, 'portable_line_export', STREAM_LINES_SQL),
        );
        yield ']}\n';
      } finally {
        await client.query('ROLLBACK').catch(() => {});
        client.release();
      }
    },

    async *streamGeometries() {
      if (typeof database.connect !== 'function') {
        yield JSON.stringify(await payload(EXPORT_GEOMETRIES_SQL));
        yield '\n';
        return;
      }
      const client = await database.connect();
      try {
        await client.query('BEGIN READ ONLY');
        const timestamp = await client.query(
          'SELECT now() AS "exportedAt"',
        );
        yield '{"type":"FeatureCollection","name":"dtpstat-project-geometries","schemaVersion":4,"exportedAt":';
        yield JSON.stringify(timestamp.rows[0]?.exportedAt ?? new Date());
        yield ',"lineTypes":[';
        const lineTypes = await client.query(STREAM_LINE_TYPES_SQL);
        let firstType = true;
        for (const row of lineTypes.rows) {
          if (!firstType) yield ',';
          firstType = false;
          yield row.item;
        }
        yield '],"features":[';
        yield* jsonArray(
          cursorItems(
            client,
            'portable_geometry_export',
            STREAM_GEOMETRIES_SQL,
          ),
        );
        yield ']}\n';
      } finally {
        await client.query('ROLLBACK').catch(() => {});
        client.release();
      }
    },

    async *streamPopulations() {
      if (typeof database.connect !== 'function') {
        yield JSON.stringify(await payload(EXPORT_POPULATIONS_SQL));
        yield '\n';
        return;
      }
      const client = await database.connect();
      try {
        await client.query('BEGIN READ ONLY');
        const timestamp = await client.query(
          'SELECT now() AS "exportedAt"',
        );
        yield '{"schemaVersion":1,"exportedAt":';
        yield JSON.stringify(timestamp.rows[0]?.exportedAt ?? new Date());
        yield ',"populations":[';
        yield* jsonArray(
          cursorItems(
            client,
            'portable_population_export',
            STREAM_POPULATIONS_SQL,
          ),
        );
        yield ']}\n';
      } finally {
        await client.query('ROLLBACK').catch(() => {});
        client.release();
      }
    },

    exportCityBoundaries() {
      return payload(EXPORT_CITY_BOUNDARIES_SQL);
    },
    exportLines() {
      return payload(EXPORT_LINES_SQL);
    },
    exportGeometries() {
      return payload(EXPORT_GEOMETRIES_SQL);
    },
    exportPopulations() {
      return payload(EXPORT_POPULATIONS_SQL);
    },
  };
}
