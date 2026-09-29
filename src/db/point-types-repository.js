import {
  PointTypeValidationError,
  normalizePointTypeCreate,
  normalizePointTypeId,
  normalizePointTypeUpdate,
} from '../modules/points/type-policy.js';
import {
  acquireDataImportLock,
} from './database-locks.js';

const LIST_SQL = `
  SELECT
    point_type.id::integer AS id,
    point_type.name,
    point_type.is_active AS "isActive",
    point_type.display_width::integer AS "displayWidth",
    point_type.display_height::integer AS "displayHeight",
    point_type.anchor_x::double precision AS "anchorX",
    point_type.anchor_y::double precision AS "anchorY",
    (point_type.icon_file_name IS NOT NULL) AS "iconConfigured",
    point_type.icon_mime AS "iconMime",
    point_type.icon_source_width::integer AS "iconSourceWidth",
    point_type.icon_source_height::integer AS "iconSourceHeight",
    point_type.icon_sha256 AS "iconSha256",
    COUNT(geometry.id)::integer AS "geometryCount",
    point_type.created_at AS "createdAt",
    point_type.updated_at AS "updatedAt"
  FROM point_types AS point_type
  LEFT JOIN city_geometries AS geometry
    ON geometry.point_type_id = point_type.id
  GROUP BY point_type.id
  ORDER BY LOWER(point_type.name), point_type.id
`;

const GET_FOR_UPDATE_SQL = `
  SELECT
    id::integer AS id,
    name,
    is_active AS "isActive",
    display_width::integer AS "displayWidth",
    display_height::integer AS "displayHeight",
    anchor_x::double precision AS "anchorX",
    anchor_y::double precision AS "anchorY",
    icon_file_name AS "iconFileName",
    icon_mime AS "iconMime",
    icon_source_width::integer AS "iconSourceWidth",
    icon_source_height::integer AS "iconSourceHeight",
    icon_sha256 AS "iconSha256",
    created_at AS "createdAt",
    updated_at AS "updatedAt"
  FROM point_types
  WHERE id = $1::bigint
  FOR UPDATE
`;

const INSERT_SQL = `
  INSERT INTO point_types (
    name,
    is_active,
    display_width,
    display_height,
    anchor_x,
    anchor_y
  )
  VALUES (
    $1::text,
    $2::boolean,
    $3::smallint,
    $4::smallint,
    $5::double precision,
    $6::double precision
  )
  RETURNING id::integer AS id
`;

const UPDATE_SQL = `
  UPDATE point_types
  SET
    name = $2::text,
    is_active = $3::boolean,
    display_width = $4::smallint,
    display_height = $5::smallint,
    anchor_x = $6::double precision,
    anchor_y = $7::double precision,
    updated_at = NOW()
  WHERE id = $1::bigint
  RETURNING id::integer AS id
`;

const DELETE_SQL = `
  DELETE FROM point_types
  WHERE id = $1::bigint
  RETURNING
    id::integer AS id,
    name,
    icon_file_name AS "iconFileName"
`;

function duplicateName(error) {
  return (
    error?.code === '23505' &&
    (
      error?.constraint ===
        'point_types_name_lower_uidx' ||
      /point_types_name_lower_uidx/iu
        .test(
          String(
            error?.message ??
            '',
          ),
        )
    )
  );
}

export function createPointTypesRepository(
  database,
) {
  async function list(
    queryable = database,
  ) {
    const result =
      await queryable.query(
        LIST_SQL,
      );
    return result.rows;
  }

  async function withTransaction(
    operation,
  ) {
    const client =
      await database.connect();
    try {
      await client.query('BEGIN');
      await acquireDataImportLock(
        client,
        database,
      );
      const result =
        await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      if (duplicateName(error)) {
        throw new PointTypeValidationError(
          'Point type name already exists',
        );
      }
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    list,

    async create(payload) {
      const value =
        normalizePointTypeCreate(
          payload,
        );
      return withTransaction(
        async (client) => {
          const inserted =
            await client.query(
              INSERT_SQL,
              [
                value.name,
                value.isActive,
                value.displayWidth,
                value.displayHeight,
                value.anchorX,
                value.anchorY,
              ],
            );
          const id =
            inserted.rows[0]?.id;
          return (
            await list(client)
          ).find(
            (item) =>
              item.id === id,
          ) ?? null;
        },
      );
    },

    async update(
      pointTypeId,
      payload,
    ) {
      const id =
        normalizePointTypeId(
          pointTypeId,
        );
      return withTransaction(
        async (client) => {
          const current =
            (
              await client.query(
                GET_FOR_UPDATE_SQL,
                [id],
              )
            ).rows[0] ??
            null;
          if (!current) {
            return null;
          }
          const value =
            normalizePointTypeUpdate(
              payload,
              current,
            );
          await client.query(
            UPDATE_SQL,
            [
              id,
              value.name,
              value.isActive,
              value.displayWidth,
              value.displayHeight,
              value.anchorX,
              value.anchorY,
            ],
          );
          return (
            await list(client)
          ).find(
            (item) =>
              item.id === id,
          ) ?? null;
        },
      );
    },

    async delete(pointTypeId) {
      const id =
        normalizePointTypeId(
          pointTypeId,
        );
      return withTransaction(
        async (client) => {
          const usage =
            await client.query(
              `SELECT COUNT(*)::integer AS count
               FROM city_geometries
               WHERE point_type_id = $1::bigint`,
              [id],
            );
          const deleted =
            await client.query(
              DELETE_SQL,
              [id],
            );
          if (!deleted.rows[0]) {
            return null;
          }
          return {
            ...deleted.rows[0],
            unlinkedGeometryCount:
              usage.rows[0]?.count ??
              0,
          };
        },
      );
    },
  };
}
