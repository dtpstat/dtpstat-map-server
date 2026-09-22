import { acquireDataImportLock } from './database-locks.js';
import { RECALCULATE_CITY_STATISTICS_SQL } from './recalculate-city-statistics.js';

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

function nullableText(value, name, max = 500) {
  if (value === null || value === undefined || value === '') return null;
  return normalizedText(value, name, max);
}

function nullableDate(value, name) {
  if (value === null || value === undefined || value === '') return null;
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    throw new OsmBoundaryAdminValidationError(
      `${name} must use YYYY-MM-DD format or null`,
    );
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(date.valueOf()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new OsmBoundaryAdminValidationError(
      `${name} must be a valid calendar date or null`,
    );
  }
  return value;
}

function attributesObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new OsmBoundaryAdminValidationError(
      'attributes must be a JSON object',
    );
  }
  return value;
}

function normalizePayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new OsmBoundaryAdminValidationError('Request body must be an object');
  }
  const allowed = new Set([
    'active',
    'displayName',
    'displayType',
    'population',
    'populationAsOf',
    'populationSource',
    'attributes',
  ]);
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
  if ('population' in value) {
    if (value.population === null || value.population === '') {
      result.population = null;
    } else {
      const population = Number(value.population);
      if (
        !Number.isSafeInteger(population) ||
        population <= 0 ||
        population > 2147483647
      ) {
        throw new OsmBoundaryAdminValidationError(
          'population must be a positive integer up to 2147483647 or null',
        );
      }
      result.population = population;
    }
  }
  if ('populationAsOf' in value) {
    result.populationAsOf = nullableDate(
      value.populationAsOf,
      'populationAsOf',
    );
  }
  if ('populationSource' in value) {
    result.populationSource = nullableText(
      value.populationSource,
      'populationSource',
    );
  }
  if ('attributes' in value) {
    result.attributes = attributesObject(value.attributes);
  }

  if (Object.keys(result).length === 0) {
    throw new OsmBoundaryAdminValidationError('No OSM boundary changes supplied');
  }
  return result;
}

function positiveId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new OsmBoundaryAdminValidationError(
      'boundaryId must be a positive integer',
    );
  }
  return id;
}

function own(value, key) {
  return Object.hasOwn(value, key);
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

    async setSubtreeActive(boundaryId, active) {
      const id = positiveId(boundaryId);
      if (typeof active !== 'boolean') {
        throw new OsmBoundaryAdminValidationError('active must be boolean');
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await acquireDataImportLock(client, pool);
        await client.query('SELECT assert_no_pending_geometry_import()');

        const subtree = await client.query(
          `WITH RECURSIVE subtree AS (
             SELECT boundary.id, boundary.is_active
             FROM city_boundaries AS boundary
             WHERE boundary.id = $1

             UNION ALL

             SELECT child.id, child.is_active
             FROM city_boundaries AS child
             JOIN subtree AS parent
               ON child.parent_id = parent.id
           )
           SELECT boundary.id::integer AS id,
                  boundary.is_active AS active
           FROM city_boundaries AS boundary
           JOIN subtree
             ON subtree.id = boundary.id
           ORDER BY boundary.id
           FOR UPDATE OF boundary`,
          [id],
        );

        if (subtree.rowCount === 0) {
          await client.query('ROLLBACK');
          return null;
        }

        const ids = subtree.rows.map((row) => row.id);
        const previousActiveCount = subtree.rows
          .filter((row) => row.active).length;
        const previousInactiveCount =
          subtree.rowCount - previousActiveCount;
        const changedCount = active
          ? previousInactiveCount
          : previousActiveCount;

        if (changedCount > 0) {
          await client.query(
            `UPDATE city_boundaries
                SET is_active = $2,
                    updated_at = now()
              WHERE id = ANY($1::bigint[])
                AND is_active IS DISTINCT FROM $2`,
            [ids, active],
          );
          await client.query('SELECT sync_active_boundary_cities()');
          await client.query('SELECT assert_city_geometry_invariants()');
          await client.query('SELECT sync_active_boundary_populations()');
          await client.query(RECALCULATE_CITY_STATISTICS_SQL);
        }

        const rootResult = await client.query(
          `SELECT
             ${BOUNDARY_COLUMNS_SQL}
           FROM city_boundaries AS boundary
           WHERE boundary.id = $1`,
          [id],
        );

        await client.query('COMMIT');
        return {
          root: rootResult.rows[0],
          active,
          affectedCount: subtree.rowCount,
          changedCount,
          previousActiveCount,
          previousInactiveCount,
        };
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (error?.code === '23505') {
          throw new OsmBoundaryAdminValidationError(
            'Cannot activate the whole branch because active OSM objects would have duplicate normalized type and name',
            409,
          );
        }
        if (error?.code === '55000') {
          throw new OsmBoundaryAdminValidationError(error.message, 409);
        }
        throw error;
      } finally {
        client.release();
      }
    },

    async update(boundaryId, changes) {
      const id = positiveId(boundaryId);
      const normalized = normalizePayload(changes);
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        await acquireDataImportLock(client, pool);
        await client.query('SELECT assert_no_pending_geometry_import()');

        const current = await client.query(
          `SELECT
             boundary.id,
             boundary.is_active AS active,
             boundary.display_name AS "displayName",
             boundary.display_type AS "displayType",
             boundary.population::integer AS population,
             boundary.population_as_of AS "populationAsOf",
             boundary.population_source AS "populationSource",
             boundary.attributes
           FROM city_boundaries AS boundary
           WHERE boundary.id = $1
           FOR UPDATE OF boundary`,
          [id],
        );
        if (!current.rows[0]) {
          await client.query('ROLLBACK');
          return null;
        }

        const previous = current.rows[0];
        const next = {
          active: own(normalized, 'active')
            ? normalized.active
            : previous.active,
          displayName: own(normalized, 'displayName')
            ? normalized.displayName
            : previous.displayName,
          displayType: own(normalized, 'displayType')
            ? normalized.displayType
            : previous.displayType,
          population: own(normalized, 'population')
            ? normalized.population
            : previous.population,
          populationAsOf: own(normalized, 'populationAsOf')
            ? normalized.populationAsOf
            : previous.populationAsOf,
          populationSource: own(normalized, 'populationSource')
            ? normalized.populationSource
            : previous.populationSource,
          attributes: own(normalized, 'attributes')
            ? normalized.attributes
            : previous.attributes,
        };

        await client.query(
          `UPDATE city_boundaries
              SET is_active = $2,
                  display_name = $3,
                  display_type = $4,
                  population = $5,
                  population_as_of = $6,
                  population_source = $7,
                  attributes = $8::jsonb,
                  updated_at = now()
            WHERE id = $1`,
          [
            id,
            next.active,
            next.displayName,
            next.displayType,
            next.population,
            next.populationAsOf,
            next.populationSource,
            JSON.stringify(next.attributes ?? {}),
          ],
        );

        await client.query('SELECT sync_active_boundary_cities()');
        await client.query('SELECT assert_city_geometry_invariants()');
        await client.query('SELECT sync_active_boundary_populations()');
        await client.query(RECALCULATE_CITY_STATISTICS_SQL);

        const finalResult = await client.query(
          `SELECT
             ${BOUNDARY_COLUMNS_SQL}
           FROM city_boundaries AS boundary
           WHERE boundary.id = $1`,
          [id],
        );
        await client.query('COMMIT');
        return finalResult.rows[0];
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (error?.code === '23505') {
          throw new OsmBoundaryAdminValidationError(
            'An active OSM object with the same normalized type and name already exists',
            409,
          );
        }
        if (error?.code === '55000') {
          throw new OsmBoundaryAdminValidationError(error.message, 409);
        }
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
