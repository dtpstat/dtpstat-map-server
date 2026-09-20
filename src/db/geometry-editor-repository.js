import { acquireDataImportLock } from './database-locks.js';
import { RECALCULATE_CITY_STATISTICS_SQL } from './recalculate-city-statistics.js';
import { GeometryEditorValidationError } from '../data/geometry-editor.js';

const FAMILY_SQL = `
  CASE
    WHEN GeometryType(geometry.geom) = 'POINT' THEN 'point'
    WHEN GeometryType(geometry.geom) IN ('LINESTRING', 'MULTILINESTRING') THEN 'line'
    WHEN GeometryType(geometry.geom) IN ('POLYGON', 'MULTIPOLYGON') THEN 'polygon'
    ELSE 'unsupported'
  END
`;

const ACTIVE_BOUNDARY_LINK_STATE_SQL = `
  SELECT
    COUNT(*)::integer AS "activeBoundaries",
    COUNT(*) FILTER (WHERE city_id IS NULL)::integer AS "unlinkedBoundaries"
  FROM city_boundaries
  WHERE is_active
`;

const CITIES_SQL = `
  SELECT
    city.id::integer AS id,
    city.slug,
    city.name,
    city.full_name AS "fullName",
    boundary.id::integer AS "boundaryId",
    json_build_array(
      ST_XMin(boundary.bounds),
      ST_YMin(boundary.bounds),
      ST_XMax(boundary.bounds),
      ST_YMax(boundary.bounds)
    ) AS bounds,
    json_build_array(
      ST_X(ST_PointOnSurface(boundary.geom)),
      ST_Y(ST_PointOnSurface(boundary.geom))
    ) AS center,
    COUNT(geometry.id)::integer AS "geometryCount"
  FROM cities AS city
  JOIN city_boundaries AS boundary
    ON boundary.city_id = city.id
   AND boundary.is_active
  LEFT JOIN city_geometries AS geometry ON geometry.city_id = city.id
  GROUP BY city.id, boundary.id
  ORDER BY city.name, city.id
`;

const CITY_SQL = `
  SELECT
    city.id::integer AS id,
    city.slug,
    city.name,
    city.full_name AS "fullName",
    boundary.id::integer AS "boundaryId",
    json_build_array(
      ST_XMin(boundary.bounds),
      ST_YMin(boundary.bounds),
      ST_XMax(boundary.bounds),
      ST_YMax(boundary.bounds)
    ) AS bounds,
    json_build_array(
      ST_X(ST_PointOnSurface(boundary.geom)),
      ST_Y(ST_PointOnSurface(boundary.geom))
    ) AS center,
    ST_AsGeoJSON(boundary.geom)::json AS "boundaryGeometry"
  FROM cities AS city
  JOIN city_boundaries AS boundary
    ON boundary.city_id = city.id
   AND boundary.is_active
  WHERE city.id = $1
  LIMIT 1
`;

const GEOMETRIES_SQL = `
  SELECT
    geometry.id::integer AS id,
    geometry.city_id::integer AS "cityId",
    geometry.boundary_id::integer AS "boundaryId",
    ${FAMILY_SQL} AS family,
    GeometryType(geometry.geom) AS "geometryType",
    geometry.display_name AS "displayName",
    geometry.tooltip,
    geometry.tags,
    geometry.source_tags AS "sourceTags",
    geometry.is_visible AS "isVisible",
    geometry.was_edited AS "wasEdited",
    geometry.line_type_id::integer AS "lineTypeId",
    line_type.code::integer AS "lineTypeCode",
    line_type.name AS "lineTypeName",
    line_type.title AS "lineTypeTitle",
    line_type.color AS "lineTypeColor",
    line_type.line_style AS "lineTypeStyle",
    line_type.width::double precision AS "lineTypeWidth",
    geometry.lanes,
    geometry.length_m AS "lengthMeters",
    geometry.lane_length_m AS "laneLengthMeters",
    CASE
      WHEN GeometryType(geometry.geom) IN ('POLYGON', 'MULTIPOLYGON')
        THEN ST_Perimeter(geometry.geom::geography)
      ELSE NULL
    END::double precision AS "perimeterMeters",
    CASE
      WHEN GeometryType(geometry.geom) IN ('POLYGON', 'MULTIPOLYGON')
        THEN ST_Area(geometry.geom::geography)
      ELSE NULL
    END::double precision AS "areaSquareMeters",
    ST_AsGeoJSON(geometry.geom)::json AS geometry,
    geometry.created_at AS "createdAt",
    geometry.updated_at AS "updatedAt"
  FROM city_geometries AS geometry
  LEFT JOIN line_types AS line_type ON line_type.id = geometry.line_type_id
  WHERE geometry.city_id = $1
  ORDER BY
    COALESCE(NULLIF(BTRIM(geometry.display_name), ''), ''),
    geometry.id
`;

const ONE_GEOMETRY_SQL = `
  SELECT wrapped.*
  FROM (
    SELECT
      geometry.id::integer AS id,
      geometry.city_id::integer AS "cityId",
      geometry.boundary_id::integer AS "boundaryId",
      ${FAMILY_SQL} AS family,
      GeometryType(geometry.geom) AS "geometryType",
      geometry.display_name AS "displayName",
      geometry.tooltip,
      geometry.tags,
      geometry.source_tags AS "sourceTags",
      geometry.is_visible AS "isVisible",
      geometry.was_edited AS "wasEdited",
      geometry.line_type_id::integer AS "lineTypeId",
      line_type.code::integer AS "lineTypeCode",
      line_type.name AS "lineTypeName",
      line_type.title AS "lineTypeTitle",
      line_type.color AS "lineTypeColor",
      line_type.line_style AS "lineTypeStyle",
      line_type.width::double precision AS "lineTypeWidth",
      geometry.lanes,
      geometry.length_m AS "lengthMeters",
      geometry.lane_length_m AS "laneLengthMeters",
      CASE
        WHEN GeometryType(geometry.geom) IN ('POLYGON', 'MULTIPOLYGON')
          THEN ST_Perimeter(geometry.geom::geography)
        ELSE NULL
      END::double precision AS "perimeterMeters",
      CASE
        WHEN GeometryType(geometry.geom) IN ('POLYGON', 'MULTIPOLYGON')
          THEN ST_Area(geometry.geom::geography)
        ELSE NULL
      END::double precision AS "areaSquareMeters",
      ST_AsGeoJSON(geometry.geom)::json AS geometry,
      geometry.created_at AS "createdAt",
      geometry.updated_at AS "updatedAt"
    FROM city_geometries AS geometry
    LEFT JOIN line_types AS line_type ON line_type.id = geometry.line_type_id
    WHERE geometry.id = $1
  ) AS wrapped
`;

const PREPARED_GEOMETRY_SQL = `
  SELECT ST_SetSRID(ST_GeomFromGeoJSON($1::text), 4326) AS geom
`;

function databaseGeometryError(error) {
  const message = String(error?.message ?? '');
  return (
    error?.code === '23514' ||
    error?.code === '22P02' ||
    error?.code === 'XX000' ||
    /geometry|GeoJSON|TopologyException|latitude|longitude/i.test(message)
  );
}

async function rollbackQuietly(client) {
  try { await client.query('ROLLBACK'); } catch { /* preserve original error */ }
}

/** @param {{ connect: Function, query: Function, databaseSchema?: string }} pool */
export function createGeometryEditorRepository(pool) {
  async function ensureActiveBoundaryCities() {
    const stateResult = await pool.query(ACTIVE_BOUNDARY_LINK_STATE_SQL);
    const state = stateResult.rows[0] ?? {
      activeBoundaries: 0,
      unlinkedBoundaries: 0,
    };
    if (Number(state.unlinkedBoundaries ?? 0) === 0) return state;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await acquireDataImportLock(client, pool);

      // Recheck after the lock: an OSM/admin operation may have repaired the
      // links while this request was waiting.
      const lockedStateResult = await client.query(ACTIVE_BOUNDARY_LINK_STATE_SQL);
      const lockedState = lockedStateResult.rows[0] ?? state;
      if (Number(lockedState.unlinkedBoundaries ?? 0) > 0) {
        await client.query('SELECT sync_active_boundary_cities()');
      }

      await client.query('COMMIT');
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }

    return (await pool.query(ACTIVE_BOUNDARY_LINK_STATE_SQL)).rows[0] ?? state;
  }

  async function one(queryable, geometryId) {
    const result = await queryable.query(ONE_GEOMETRY_SQL, [geometryId]);
    return result.rows[0] ?? null;
  }

  async function lineTypeExists(queryable, lineTypeId) {
    if (lineTypeId === null) return true;
    const result = await queryable.query(
      'SELECT 1 FROM line_types WHERE id = $1',
      [lineTypeId],
    );
    return Boolean(result.rows[0]);
  }

  async function write(operation) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await acquireDataImportLock(client, pool);
      await client.query('SELECT assert_no_pending_geometry_import()');
      const result = await operation(client);
      await client.query(RECALCULATE_CITY_STATISTICS_SQL);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await rollbackQuietly(client);
      if (databaseGeometryError(error) && !(error instanceof GeometryEditorValidationError)) {
        throw new GeometryEditorValidationError(`Invalid geometry: ${error.message}`);
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async function updateGeometryRow(client, geometryId, payload) {
    if (!await lineTypeExists(client, payload.lineTypeId)) {
      throw new GeometryEditorValidationError('lineTypeId does not exist');
    }
    const prepared = await client.query(PREPARED_GEOMETRY_SQL, [
      JSON.stringify(payload.geometry),
    ]);
    const geom = prepared.rows[0]?.geom;
    if (!geom) throw new GeometryEditorValidationError('GeoJSON geometry could not be parsed');

    const result = await client.query(`
      WITH prepared AS (
        SELECT $2::geometry AS geom
      )
      UPDATE city_geometries AS geometry
      SET
        geom = prepared.geom,
        line_type_id = $3,
        lanes = $4,
        length_m = CASE
          WHEN GeometryType(prepared.geom) IN ('LINESTRING', 'MULTILINESTRING')
            THEN ST_Length(prepared.geom::geography)
          ELSE NULL
        END,
        lane_length_m = CASE
          WHEN GeometryType(prepared.geom) IN ('LINESTRING', 'MULTILINESTRING')
            THEN ST_Length(prepared.geom::geography) * $4::smallint
          ELSE NULL
        END,
        display_name = $5,
        tooltip = $6,
        tags = $7::text[],
        is_visible = $8,
        was_edited = TRUE,
        updated_at = NOW()
      FROM prepared
      WHERE geometry.id = $1
        AND NOT ST_IsEmpty(prepared.geom)
        AND ST_IsValid(prepared.geom)
      RETURNING geometry.id
    `, [
      geometryId,
      geom,
      payload.lineTypeId,
      payload.lanes,
      payload.displayName,
      payload.tooltip,
      payload.tags,
      payload.isVisible,
    ]);
    if (!result.rows[0]) {
      const exists = await client.query(
        'SELECT 1 FROM city_geometries WHERE id = $1',
        [geometryId],
      );
      if (!exists.rows[0]) return null;
      throw new GeometryEditorValidationError('Geometry must be non-empty and valid');
    }
    return one(client, geometryId);
  }

  return {
    async get(geometryId) {
      return one(pool, geometryId);
    },

    async listCities() {
      const linkState = await ensureActiveBoundaryCities();
      const result = await pool.query(CITIES_SQL);
      return {
        cities: result.rows,
        linkState,
      };
    },

    async listCity(cityId) {
      await ensureActiveBoundaryCities();
      const [cityResult, geometries] = await Promise.all([
        pool.query(CITY_SQL, [cityId]),
        pool.query(GEOMETRIES_SQL, [cityId]),
      ]);
      const city = cityResult.rows[0] ?? null;
      return city ? { city, geometries: geometries.rows } : null;
    },

    async listTags() {
      const result = await pool.query(`
        SELECT DISTINCT tag
        FROM city_geometries
        CROSS JOIN LATERAL unnest(tags) AS tag
        WHERE BTRIM(tag) <> ''
        ORDER BY LOWER(tag), tag
      `);
      return result.rows.map((row) => row.tag);
    },

    async create(payload) {
      return write(async (client) => {
        if (!await lineTypeExists(client, payload.lineTypeId)) {
          throw new GeometryEditorValidationError('lineTypeId does not exist');
        }
        const boundary = await client.query(`
          SELECT boundary.id
          FROM city_boundaries AS boundary
          WHERE boundary.city_id = $1
            AND boundary.is_active
          LIMIT 1
          FOR SHARE
        `, [payload.cityId]);
        if (!boundary.rows[0]) {
          throw new GeometryEditorValidationError(
            'Selected city has no active OSM boundary',
            409,
          );
        }

        const prepared = await client.query(PREPARED_GEOMETRY_SQL, [
          JSON.stringify(payload.geometry),
        ]);
        const geom = prepared.rows[0]?.geom;
        const inserted = await client.query(`
          WITH prepared AS (SELECT $3::geometry AS geom)
          INSERT INTO city_geometries (
            city_id,
            boundary_id,
            line_type_id,
            lanes,
            length_m,
            lane_length_m,
            properties,
            geom,
            display_name,
            tooltip,
            tags,
            source_tags,
            is_visible,
            was_edited,
            updated_at
          )
          SELECT
            $1,
            $2,
            $4,
            $5,
            CASE
              WHEN GeometryType(prepared.geom) IN ('LINESTRING', 'MULTILINESTRING')
                THEN ST_Length(prepared.geom::geography)
              ELSE NULL
            END,
            CASE
              WHEN GeometryType(prepared.geom) IN ('LINESTRING', 'MULTILINESTRING')
                THEN ST_Length(prepared.geom::geography) * $5::smallint
              ELSE NULL
            END,
            jsonb_build_object('source', 'manual'),
            prepared.geom,
            $6,
            $7,
            $8::text[],
            '{}'::jsonb,
            $9,
            TRUE,
            NOW()
          FROM prepared
          WHERE NOT ST_IsEmpty(prepared.geom)
            AND ST_IsValid(prepared.geom)
          RETURNING id::integer AS id
        `, [
          payload.cityId,
          boundary.rows[0].id,
          geom,
          payload.lineTypeId,
          payload.lanes,
          payload.displayName,
          payload.tooltip,
          payload.tags,
          payload.isVisible,
        ]);
        if (!inserted.rows[0]) {
          throw new GeometryEditorValidationError('Geometry must be non-empty and valid');
        }
        return one(client, inserted.rows[0].id);
      });
    },

    async update(geometryId, payload) {
      return write(async (client) => {
        await client.query(
          'SELECT id FROM city_geometries WHERE id = $1 FOR UPDATE',
          [geometryId],
        );
        return updateGeometryRow(client, geometryId, payload);
      });
    },

    async delete(geometryId) {
      return write(async (client) => {
        const previous = await one(client, geometryId);
        if (!previous) return null;
        await client.query('DELETE FROM city_geometries WHERE id = $1', [geometryId]);
        return previous;
      });
    },

    async merge(ids) {
      return write(async (client) => {
        const rows = await client.query(`
          SELECT
            geometry.id::integer AS id,
            geometry.city_id::integer AS "cityId",
            CASE
              WHEN GeometryType(geometry.geom) = 'POINT' THEN 'point'
              WHEN GeometryType(geometry.geom) IN ('LINESTRING', 'MULTILINESTRING') THEN 'line'
              WHEN GeometryType(geometry.geom) IN ('POLYGON', 'MULTIPOLYGON') THEN 'polygon'
            END AS family,
            geometry.line_type_id::integer AS "lineTypeId",
            geometry.lanes,
            geometry.is_visible AS "isVisible",
            geometry.source_tags AS "sourceTags"
          FROM city_geometries AS geometry
          WHERE geometry.id = ANY($1::bigint[])
          ORDER BY array_position($1::bigint[], geometry.id)
          FOR UPDATE
        `, [ids]);
        if (rows.rows.length !== ids.length) {
          throw new GeometryEditorValidationError('One or more selected geometries no longer exist', 409);
        }
        const first = rows.rows[0];
        if (first.family === 'point') {
          throw new GeometryEditorValidationError('Point geometries cannot be merged');
        }
        if (rows.rows.some((row) => row.cityId !== first.cityId || row.family !== first.family)) {
          throw new GeometryEditorValidationError('Merged geometries must belong to the same city and geometry family');
        }
        if (rows.rows.some((row) => row.isVisible !== first.isVisible)) {
          throw new GeometryEditorValidationError('Merged geometries must have the same visibility');
        }
        if (
          first.family === 'line' &&
          rows.rows.some((row) =>
            row.lineTypeId !== first.lineTypeId || row.lanes !== first.lanes)
        ) {
          throw new GeometryEditorValidationError('Merged lines must have the same line type and lanes');
        }

        const sameSourceTags = rows.rows.every(
          (row) => JSON.stringify(row.sourceTags) === JSON.stringify(first.sourceTags),
        );
        const merged = await client.query(`
          WITH selected AS (
            SELECT geom
            FROM city_geometries
            WHERE id = ANY($2::bigint[])
          ),
          merged AS (
            SELECT CASE
              WHEN $3 = 'line' THEN
                ST_Multi(ST_CollectionExtract(ST_Collect(geom), 2))
              ELSE
                ST_Multi(
                  ST_CollectionExtract(
                    ST_MakeValid(ST_UnaryUnion(ST_Collect(geom))),
                    3
                  )
                )
            END AS geom
            FROM selected
          )
          UPDATE city_geometries AS target
          SET
            geom = merged.geom,
            length_m = CASE
              WHEN $3 = 'line' THEN ST_Length(merged.geom::geography)
              ELSE NULL
            END,
            lane_length_m = CASE
              WHEN $3 = 'line' THEN ST_Length(merged.geom::geography) * target.lanes
              ELSE NULL
            END,
            source_tags = CASE WHEN $4 THEN target.source_tags ELSE '{}'::jsonb END,
            was_edited = TRUE,
            updated_at = NOW()
          FROM merged
          WHERE target.id = $1
            AND NOT ST_IsEmpty(merged.geom)
            AND ST_IsValid(merged.geom)
          RETURNING target.id
        `, [ids[0], ids, first.family, sameSourceTags]);
        if (!merged.rows[0]) {
          throw new GeometryEditorValidationError('Merged geometry is empty or invalid');
        }
        await client.query(
          'DELETE FROM city_geometries WHERE id = ANY($1::bigint[]) AND id <> $2',
          [ids, ids[0]],
        );
        return one(client, ids[0]);
      });
    },

    async cut(targetId, cutterGeometry) {
      return write(async (client) => {
        const target = await one(client, targetId);
        if (!target) return null;
        if (target.family !== 'polygon') {
          throw new GeometryEditorValidationError('Only polygons can be cut');
        }
        await client.query(
          'SELECT id FROM city_geometries WHERE id = $1 FOR UPDATE',
          [targetId],
        );
        const prepared = await client.query(PREPARED_GEOMETRY_SQL, [
          JSON.stringify(cutterGeometry),
        ]);
        const cutter = prepared.rows[0]?.geom;
        const result = await client.query(`
          WITH difference AS (
            SELECT ST_Multi(
              ST_CollectionExtract(
                ST_MakeValid(ST_Difference(geom, $2::geometry)),
                3
              )
            ) AS geom
            FROM city_geometries
            WHERE id = $1
          )
          UPDATE city_geometries AS geometry
          SET
            geom = difference.geom,
            was_edited = TRUE,
            updated_at = NOW()
          FROM difference
          WHERE geometry.id = $1
            AND NOT ST_IsEmpty(difference.geom)
            AND ST_IsValid(difference.geom)
          RETURNING geometry.id
        `, [targetId, cutter]);
        if (!result.rows[0]) {
          throw new GeometryEditorValidationError(
            'Cut would remove the whole polygon or produce an invalid result',
          );
        }
        return one(client, targetId);
      });
    },
  };
}
