import { RECALCULATE_CITY_STATISTICS_SQL } from './recalculate-city-statistics.js';

const LIST_SQL = `
  SELECT
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
    boundary.tags,
    boundary.updated_at AS "updatedAt"
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

export class OsmBoundaryAdminValidationError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'OsmBoundaryAdminValidationError';
    this.statusCode = statusCode;
  }
}

function normalizedText(value, name, max = 160) {
  if (typeof value !== 'string') {
    throw new OsmBoundaryAdminValidationError(`${name} must be a string`);
  }
  const normalized = value.trim().normalize('NFC');
  if (!normalized || normalized.length > max) {
    throw new OsmBoundaryAdminValidationError(
      `${name} must contain 1-${max} characters`,
    );
  }
  return normalized;
}

function normalizePayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new OsmBoundaryAdminValidationError('Request body must be an object');
  }
  const allowed = new Set(['active', 'displayName', 'displayType']);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new OsmBoundaryAdminValidationError(
      `Unsupported OSM boundary fields: ${unknown.join(', ')}`,
    );
  }
  const result = {};
  if ('active' in value) {
    if (typeof value.active !== 'boolean') {
      throw new OsmBoundaryAdminValidationError('active must be boolean');
    }
    result.active = value.active;
  }
  if ('displayName' in value) {
    result.displayName = normalizedText(value.displayName, 'displayName');
  }
  if ('displayType' in value) {
    result.displayType = normalizedText(value.displayType, 'displayType', 80);
  }
  if (Object.keys(result).length === 0) {
    throw new OsmBoundaryAdminValidationError('No OSM boundary changes supplied');
  }
  return result;
}

function positiveId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new OsmBoundaryAdminValidationError('boundaryId must be a positive integer');
  }
  return id;
}

/** @param {{ query: Function, connect: Function }} pool */
export function createOsmBoundaryAdminRepository(pool) {
  return {
    async list() {
      const result = await pool.query(LIST_SQL);
      return result.rows;
    },

    async getGeometry(boundaryId) {
      const id = positiveId(boundaryId);
      const result = await pool.query(GEOMETRY_SQL, [id]);
      return result.rows[0]?.feature ?? null;
    },

    async update(boundaryId, changes) {
      const id = positiveId(boundaryId);
      const normalized = normalizePayload(changes);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const current = await client.query(
          `SELECT id, is_active AS active, display_name AS "displayName",
                  display_type AS "displayType"
             FROM city_boundaries
            WHERE id = $1
            FOR UPDATE`,
          [id],
        );
        if (!current.rows[0]) {
          await client.query('ROLLBACK');
          return null;
        }
        const next = {
          active: normalized.active ?? current.rows[0].active,
          displayName: normalized.displayName ?? current.rows[0].displayName,
          displayType: normalized.displayType ?? current.rows[0].displayType,
        };
        const result = await client.query(
          `UPDATE city_boundaries
              SET is_active = $2,
                  display_name = $3,
                  display_type = $4,
                  updated_at = now()
            WHERE id = $1
            RETURNING id::integer AS id,
                      parent_id::integer AS "parentId",
                      osm_type AS "osmType",
                      osm_id::text AS "osmId",
                      osm_name AS "osmName",
                      place_type AS "placeType",
                      admin_level::integer AS "adminLevel",
                      is_active AS active,
                      display_name AS "displayName",
                      display_type AS "displayType",
                      area_m2 / 1000000.0 AS "areaKm2",
                      city_id::integer AS "cityId",
                      tags,
                      updated_at AS "updatedAt"`,
          [id, next.active, next.displayName, next.displayType],
        );
        await client.query('SELECT sync_active_boundary_cities()');
        await client.query(RECALCULATE_CITY_STATISTICS_SQL);
        await client.query('COMMIT');
        return result.rows[0];
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (error?.code === '23505') {
          throw new OsmBoundaryAdminValidationError(
            'An active OSM object with the same normalized type and name already exists',
            409,
          );
        }
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
