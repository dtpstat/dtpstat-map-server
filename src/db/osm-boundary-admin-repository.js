import { acquireDataImportLock } from './database-locks.js';
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
    population.population::integer AS population,
    population.as_of AS "populationAsOf",
    population.source AS "populationSource",
    boundary.tags,
    boundary.updated_at AS "updatedAt"
  FROM city_boundaries AS boundary
  LEFT JOIN city_populations AS population
    ON population.city_id = boundary.city_id
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
  const allowed = new Set(['active', 'displayName', 'displayType', 'population']);
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

    async setSubtreeActive(boundaryId, active) {
      const id = positiveId(boundaryId);
      if (typeof active !== 'boolean') {
        throw new OsmBoundaryAdminValidationError('active must be boolean');
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await acquireDataImportLock(client, pool);

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
        const previousActiveCount = subtree.rows.filter((row) => row.active).length;
        const previousInactiveCount = subtree.rowCount - previousActiveCount;
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
          await client.query(RECALCULATE_CITY_STATISTICS_SQL);
        }

        const rootResult = await client.query(
          `SELECT
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
             population.population::integer AS population,
             population.as_of AS "populationAsOf",
             population.source AS "populationSource",
             boundary.tags,
             boundary.updated_at AS "updatedAt"
           FROM city_boundaries AS boundary
           LEFT JOIN city_populations AS population
             ON population.city_id = boundary.city_id
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
        const current = await client.query(
          `SELECT
                  boundary.id,
                  boundary.is_active AS active,
                  boundary.display_name AS "displayName",
                  boundary.display_type AS "displayType",
                  boundary.city_id::integer AS "cityId",
                  population.population::integer AS population
             FROM city_boundaries AS boundary
             LEFT JOIN city_populations AS population
               ON population.city_id = boundary.city_id
            WHERE boundary.id = $1
            FOR UPDATE OF boundary`,
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
        await client.query(
          `UPDATE city_boundaries
              SET is_active = $2,
                  display_name = $3,
                  display_type = $4,
                  updated_at = now()
            WHERE id = $1`,
          [id, next.active, next.displayName, next.displayType],
        );
        await client.query('SELECT sync_active_boundary_cities()');

        const resolvedResult = await client.query(
          `SELECT city_id::integer AS "cityId"
             FROM city_boundaries
            WHERE id = $1`,
          [id],
        );
        const oldCityId = current.rows[0].cityId;
        const cityId = resolvedResult.rows[0]?.cityId ?? null;

        if (Object.hasOwn(normalized, 'population')) {
          if (!next.active) {
            throw new OsmBoundaryAdminValidationError(
              'population can only be edited for an active OSM boundary',
            );
          }
          if (cityId === null) {
            throw new OsmBoundaryAdminValidationError(
              'Active OSM boundary has no linked city',
              409,
            );
          }
          if (normalized.population === null) {
            await client.query(
              'DELETE FROM city_populations WHERE city_id = $1',
              [cityId],
            );
          } else {
            await client.query(
              `INSERT INTO city_populations (city_id, population)
               VALUES ($1, $2)
               ON CONFLICT (city_id) DO UPDATE SET
                 population = EXCLUDED.population,
                 updated_at = now()`,
              [cityId, normalized.population],
            );
          }
        } else if (
          next.active &&
          oldCityId !== null &&
          cityId !== null &&
          oldCityId !== cityId &&
          current.rows[0].population !== null
        ) {
          // Renaming/retyping an active boundary may rebind it to another
          // application city. Preserve its existing population when the target
          // city has no population of its own.
          await client.query(
            `INSERT INTO city_populations (
               city_id, population, as_of, source, attributes
             )
             SELECT $2, population, as_of, source, attributes
             FROM city_populations
             WHERE city_id = $1
             ON CONFLICT (city_id) DO NOTHING`,
            [oldCityId, cityId],
          );
        }

        if (oldCityId !== null && cityId !== oldCityId) {
          await client.query(
            `DELETE FROM city_populations AS population
             WHERE population.city_id = $1
               AND NOT EXISTS (
                 SELECT 1
                 FROM city_boundaries AS boundary
                 WHERE boundary.city_id = $1
                   AND boundary.is_active
               )
               AND NOT EXISTS (
                 SELECT 1
                 FROM city_geometries AS geometry
                 WHERE geometry.city_id = $1
               )`,
            [oldCityId],
          );
        }

        await client.query(RECALCULATE_CITY_STATISTICS_SQL);
        const finalResult = await client.query(
          `SELECT
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
             population.population::integer AS population,
             population.as_of AS "populationAsOf",
             population.source AS "populationSource",
             boundary.tags,
             boundary.updated_at AS "updatedAt"
           FROM city_boundaries AS boundary
           LEFT JOIN city_populations AS population
             ON population.city_id = boundary.city_id
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
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
