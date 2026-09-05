import {
  buildLineTypeSettingsPlan,
  LineTypeValidationError,
} from '../data/line-types.js';
import { acquireDataImportLock } from './database-locks.js';

const LIST_LINE_TYPES_SQL = `
  SELECT
    line_type.id::integer AS id,
    line_type.code::integer AS code,
    line_type.name,
    line_type.title,
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
    line_type.title,
    line_type.color,
    line_type.line_style,
    line_type.width
  ORDER BY line_type.code
`;

const CREATE_STAGE_SQL = `
  CREATE TEMP TABLE line_type_settings_stage (
    code integer PRIMARY KEY,
    title text NOT NULL,
    color text NOT NULL,
    line_style text NOT NULL,
    width double precision NOT NULL
  ) ON COMMIT DROP
`;

const INSERT_STAGE_SQL = `
  INSERT INTO line_type_settings_stage (code, title, color, line_style, width)
  SELECT
    payload.code,
    payload.title,
    payload.color,
    payload.style,
    payload.width
  FROM jsonb_to_recordset($1::jsonb) AS payload(
    code integer,
    title text,
    color text,
    style text,
    width double precision
  )
`;

const FIND_UNKNOWN_CODES_SQL = `
  SELECT stage.code
  FROM line_type_settings_stage AS stage
  LEFT JOIN line_types AS line_type ON line_type.code = stage.code
  WHERE line_type.id IS NULL
  ORDER BY stage.code
`;

const UPDATE_SETTINGS_SQL = `
  UPDATE line_types AS line_type
  SET title = stage.title,
      color = stage.color,
      line_style = stage.line_style,
      width = stage.width,
      updated_at = now()
  FROM line_type_settings_stage AS stage
  WHERE line_type.code = stage.code
`;

/** @param {{ query: Function, connect: Function, databaseSchema?: string }} database */
export function createLineTypesRepository(database) {
  async function list(queryable = database) {
    const result = await queryable.query(LIST_LINE_TYPES_SQL);
    return result.rows;
  }

  return {
    list,

    /** @param {unknown} payload */
    async save(payload) {
      const plan = buildLineTypeSettingsPlan(payload);
      const client = await database.connect();
      try {
        await client.query('BEGIN');
        await acquireDataImportLock(client, database);
        await client.query(CREATE_STAGE_SQL);
        await client.query(INSERT_STAGE_SQL, [JSON.stringify(plan.lineTypes)]);

        const unknown = await client.query(FIND_UNKNOWN_CODES_SQL);
        if (unknown.rows.length > 0) {
          throw new LineTypeValidationError(
            `Unknown line type codes: ${unknown.rows.map((row) => row.code).join(', ')}`,
          );
        }

        await client.query(UPDATE_SETTINGS_SQL);
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
