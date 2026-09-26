const BOUNDARY_COLUMNS_SQL = `
  boundary.id::integer AS id,
  boundary.parent_id::integer AS "parentId",
  boundary.osm_type AS "osmType",
  boundary.osm_id::text AS "osmId",
  boundary.osm_name AS "osmName",
  boundary.place_type AS "placeType",
  boundary.admin_level::integer AS "adminLevel",
  boundary.is_active AS active,
  boundary.display_name AS "displayName",
  boundary.display_type AS "displayType",
  boundary.area_m2 / 1000000.0 AS "areaKm2",
  boundary.city_id::integer AS "cityId",
  boundary.population::integer AS population,
  boundary.population_as_of AS "populationAsOf",
  boundary.population_source AS "populationSource",
  boundary.attributes,
  boundary.tags,
  boundary.updated_at AS "updatedAt"
`;

const LIST_SQL = `
  SELECT
    ${BOUNDARY_COLUMNS_SQL}
  FROM city_boundaries AS boundary
  ORDER BY
    COALESCE(boundary.parent_id, 0),
    boundary.display_name,
    boundary.display_type,
    boundary.id
`;

const GEOMETRY_SQL = `
  SELECT json_build_object(
    'type', 'Feature',
    'id', boundary.id,
    'geometry', ST_AsGeoJSON(boundary.geom)::json,
    'properties', jsonb_build_object(
      'osmType', boundary.osm_type,
      'osmId', boundary.osm_id,
      'osmName', boundary.osm_name,
      'placeType', boundary.place_type,
      'adminLevel', boundary.admin_level,
      'active', boundary.is_active,
      'displayName', boundary.display_name,
      'displayType', boundary.display_type,
      'areaKm2', boundary.area_m2 / 1000000.0
    )
  ) AS feature
  FROM city_boundaries AS boundary
  WHERE boundary.id = $1
`;

const LOCK_SUBTREE_SQL = `
  WITH RECURSIVE subtree AS (
    SELECT boundary.id, boundary.is_active
    FROM city_boundaries AS boundary
    WHERE boundary.id = $1

    UNION ALL

    SELECT child.id, child.is_active
    FROM city_boundaries AS child
    JOIN subtree AS parent
      ON child.parent_id = parent.id
  )
  SELECT
    boundary.id::integer AS id,
    boundary.is_active AS active
  FROM city_boundaries AS boundary
  JOIN subtree
    ON subtree.id = boundary.id
  ORDER BY boundary.id
  FOR UPDATE OF boundary
`;

const LOCK_BOUNDARY_SQL = `
  SELECT
    boundary.id,
    boundary.is_active AS active,
    boundary.display_name AS "displayName",
    boundary.display_type AS "displayType",
    boundary.population::integer AS population,
    boundary.population_as_of AS "populationAsOf",
    boundary.population_source AS "populationSource",
    boundary.attributes,
    boundary.updated_at AS "updatedAt"
  FROM city_boundaries AS boundary
  WHERE boundary.id = $1
  FOR UPDATE OF boundary
`;

const UPDATE_BOUNDARY_SQL = `
  UPDATE city_boundaries
  SET
    is_active = $2,
    display_name = $3,
    display_type = $4,
    population = $5,
    population_as_of = $6,
    population_source = $7,
    attributes = $8::jsonb,
    updated_at = now()
  WHERE id = $1
`;

const UPDATE_SUBTREE_ACTIVE_SQL = `
  UPDATE city_boundaries
  SET
    is_active = $2,
    updated_at = now()
  WHERE id = ANY($1::bigint[])
    AND is_active IS DISTINCT FROM $2
`;

export function createOsmBoundaryAdminStorage(database) {
  return {
    async list() {
      const result = await database.query(LIST_SQL);
      return result.rows;
    },

    async getGeometry(boundaryId) {
      const result = await database.query(
        GEOMETRY_SQL,
        [boundaryId],
      );
      return result.rows[0]?.feature ?? null;
    },

    async getBoundary(queryable, boundaryId) {
      const result = await queryable.query(
        `SELECT
           ${BOUNDARY_COLUMNS_SQL}
         FROM city_boundaries AS boundary
         WHERE boundary.id = $1`,
        [boundaryId],
      );
      return result.rows[0] ?? null;
    },

    async lockSubtree(client, boundaryId) {
      const result = await client.query(
        LOCK_SUBTREE_SQL,
        [boundaryId],
      );
      return result.rows;
    },

    updateSubtreeActive(client, ids, active) {
      return client.query(
        UPDATE_SUBTREE_ACTIVE_SQL,
        [ids, active],
      );
    },

    async lockBoundary(client, boundaryId) {
      const result = await client.query(
        LOCK_BOUNDARY_SQL,
        [boundaryId],
      );
      return result.rows[0] ?? null;
    },

    updateBoundary(client, boundaryId, value) {
      return client.query(
        UPDATE_BOUNDARY_SQL,
        [
          boundaryId,
          value.active,
          value.displayName,
          value.displayType,
          value.population,
          value.populationAsOf,
          value.populationSource,
          JSON.stringify(value.attributes ?? {}),
        ],
      );
    },
  };
}
