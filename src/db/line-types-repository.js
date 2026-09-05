import {
  buildLineTypesPlan,
  LineTypeValidationError,
} from '../data/line-types.js';

const LIST_LINE_TYPES_SQL = `
  SELECT
    line_type.id::integer AS id,
    line_type.code AS type,
    line_type.name,
    line_type.color,
    line_type.line_style AS style,
    line_type.width::double precision AS width,
    count(geometry.id)::integer AS "geometryCount"
  FROM line_types AS line_type
  LEFT JOIN city_geometries AS geometry
    ON geometry.line_type_id = line_type.id
  GROUP BY
    line_type.id,
    line_type.code,
    line_type.name,
    line_type.color,
    line_type.line_style,
    line_type.width
  ORDER BY
    (line_type.code = 'default') DESC,
    line_type.name,
    line_type.code
`;

const CREATE_STAGE_SQL = `
  CREATE TEMP TABLE line_type_settings_stage (
    code text PRIMARY KEY,
    name text NOT NULL,
    color text NOT NULL,
    line_style text NOT NULL,
    width double precision NOT NULL
  ) ON COMMIT DROP
`;

const INSERT_STAGE_SQL = `
  INSERT INTO line_type_settings_stage (code, name, color, line_style, width)
  SELECT
    payload.type,
    payload.name,
    payload.color,
    payload.style,
    payload.width
  FROM jsonb_to_recordset($1::jsonb) AS payload(
    type text,
    name text,
    color text,
    style text,
    width double precision
  )
`;

const REFERENCED_OMITTED_SQL = `
  SELECT line_type.code, count(geometry.id)::integer AS geometry_count
  FROM line_types AS line_type
  JOIN city_geometries AS geometry ON geometry.line_type_id = line_type.id
  LEFT JOIN line_type_settings_stage AS stage ON stage.code = line_type.code
  WHERE stage.code IS NULL
  GROUP BY line_type.code
  ORDER BY line_type.code
`;

const UPSERT_SQL = `
  INSERT INTO line_types (code, name, color, line_style, width)
  SELECT code, name, color, line_style, width
  FROM line_type_settings_stage
  ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    color = EXCLUDED.color,
    line_style = EXCLUDED.line_style,
    width = EXCLUDED.width,
    updated_at = now()
`;

const DELETE_UNUSED_OMITTED_SQL = `
  DELETE FROM line_types AS line_type
  WHERE line_type.code <> 'default'
    AND NOT EXISTS (
      SELECT 1
      FROM line_type_settings_stage AS stage
      WHERE stage.code = line_type.code
    )
    AND NOT EXISTS (
      SELECT 1
      FROM city_geometries AS geometry
      WHERE geometry.line_type_id = line_type.id
    )
`;

/** @param {{ query: Function, connect: Function }} database */
export function createLineTypesRepository(database) {
  async function list(queryable = database) {
    const result = await queryable.query(LIST_LINE_TYPES_SQL);
    return result.rows;
  }

  return {
    list,

    /** @param {unknown} payload */
    async save(payload) {
      const plan = buildLineTypesPlan(payload);
      const client = await database.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `SELECT pg_advisory_xact_lock(hashtext('dtpstat-buslines:data-import'))`,
        );
        await client.query(CREATE_STAGE_SQL);
        await client.query(INSERT_STAGE_SQL, [JSON.stringify(plan.lineTypes)]);

        const referenced = await client.query(REFERENCED_OMITTED_SQL);
        if (referenced.rows.length > 0) {
          const description = referenced.rows
            .map((row) => `${row.code} (${row.geometry_count})`)
            .join(', ');
          throw new LineTypeValidationError(
            `Cannot remove line types that are used by geometries: ${description}`,
          );
        }

        await client.query(DELETE_UNUSED_OMITTED_SQL);
        await client.query(UPSERT_SQL);
        const result = await list(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
