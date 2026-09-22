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

const POPULATION_TERRITORIES_SQL = `
  WITH RECURSIVE territory_tree AS (
    SELECT
      boundary.id,
      boundary.parent_id,
      0::integer AS depth,
      ARRAY[boundary.id]::bigint[] AS sort_path
    FROM city_boundaries AS boundary
    WHERE boundary.parent_id IS NULL

    UNION ALL

    SELECT
      child.id,
      child.parent_id,
      parent.depth + 1,
      parent.sort_path || child.id
    FROM city_boundaries AS child
    JOIN territory_tree AS parent
      ON child.parent_id = parent.id
  )
  SELECT
    boundary.id::integer AS id,
    boundary.parent_id::integer AS "parentId",
    tree.depth::integer AS depth,
    EXISTS (
      SELECT 1
      FROM city_boundaries AS child
      WHERE child.parent_id = boundary.id
    ) AS "hasChildren",
    boundary.osm_type AS "osmType",
    boundary.osm_id::text AS "osmId",
    boundary.display_name AS name,
    boundary.display_type AS type,
    boundary.place_type AS "placeType",
    boundary.admin_level::integer AS "adminLevel",
    boundary.population::integer AS population,
    boundary.population_as_of AS "asOf",
    boundary.population_source AS source,
    boundary.attributes
  FROM territory_tree AS tree
  JOIN city_boundaries AS boundary ON boundary.id = tree.id
  ORDER BY tree.sort_path
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

function dateOnly(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function populationNode(row) {
  return {
    osmType: row.osmType,
    osmId: String(row.osmId),
    name: row.name,
    type: row.type,
    placeType: row.placeType ?? null,
    adminLevel: row.adminLevel ?? null,
    population: row.population ?? null,
    asOf: dateOnly(row.asOf),
    source: row.source ?? null,
    attributes: row.attributes ?? {},
  };
}

function buildPopulationHierarchy(rows) {
  const nodes = new Map();
  const roots = [];
  for (const row of rows) {
    const node = { ...populationNode(row), children: [] };
    nodes.set(row.id, node);
    if (row.parentId === null || row.parentId === undefined) {
      roots.push(node);
      continue;
    }
    const parent = nodes.get(row.parentId);
    if (!parent) {
      throw new Error(
        `Population export hierarchy is not in parent-first order at boundary ${row.id}`,
      );
    }
    parent.children.push(node);
  }
  return roots;
}

async function* streamPopulationHierarchy(rows) {
  let previousDepth = -1;
  let first = true;

  for await (const row of rows) {
    const depth = Number(row.depth);
    if (!Number.isInteger(depth) || depth < 0) {
      throw new Error('Population export produced an invalid hierarchy depth');
    }
    if (!first && depth > previousDepth + 1) {
      throw new Error('Population export hierarchy skipped a parent level');
    }

    if (!first) {
      if (depth === previousDepth) {
        yield ',';
      } else if (depth < previousDepth) {
        for (let level = previousDepth; level > depth; level -= 1) {
          yield ']}';
        }
        yield ',';
      }
    }

    const node = JSON.stringify(populationNode(row));
    if (row.hasChildren) {
      yield node.slice(0, -1);
      yield ',"children":[';
    } else {
      yield node;
    }

    previousDepth = depth;
    first = false;
  }

  if (!first) {
    for (let level = previousDepth; level > 0; level -= 1) {
      yield ']}';
    }
  }
}

/**
 * Read-only portable snapshots used for backup, transfer and synchronization.
 * @param {{ query: (text: string, values?: unknown[]) => Promise<{rows: any[]}>, connect?: Function }} database
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

    async *streamPopulations() {
      if (typeof database.connect !== 'function') {
        yield JSON.stringify(await this.exportPopulations());
        yield '\n';
        return;
      }
      const client = await database.connect();
      try {
        await client.query('BEGIN READ ONLY');
        const timestamp = await client.query(
          'SELECT now() AS "exportedAt"',
        );
        yield '{"schemaVersion":2,"exportedAt":';
        yield JSON.stringify(timestamp.rows[0]?.exportedAt ?? new Date());
        yield ',"territories":[';
        yield* streamPopulationHierarchy(
          cursorRows(
            client,
            'portable_population_export',
            POPULATION_TERRITORIES_SQL,
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

    async exportPopulations() {
      const [timestamp, rows] = await Promise.all([
        database.query('SELECT now() AS "exportedAt"'),
        database.query(POPULATION_TERRITORIES_SQL),
      ]);
      return {
        schemaVersion: 2,
        exportedAt: timestamp.rows[0]?.exportedAt ?? new Date(),
        territories: buildPopulationHierarchy(rows.rows),
      };
    },
  };
}
