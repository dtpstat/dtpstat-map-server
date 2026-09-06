import {
  orderReportMetricsByDependencies,
  reportMetricToRpn,
  ReportConfigValidationError,
  validateReportConfig,
} from '../data/report-config.js';
import { acquireDataImportLock } from './database-locks.js';

const LOAD_CONFIG_SQL = `
  SELECT
    metrics,
    table_columns AS "tableColumns",
    csv_columns AS "csvColumns",
    rank_metric_key AS "rankMetricKey",
    rank_direction AS "rankDirection",
    updated_at AS "updatedAt"
  FROM report_config
  WHERE id = 1
`;

const SAVE_CONFIG_SQL = `
  INSERT INTO report_config (
    id,
    metrics,
    table_columns,
    csv_columns,
    rank_metric_key,
    rank_direction,
    updated_at
  )
  VALUES (1, $1::jsonb, $2::jsonb, $3::jsonb, $4, $5, now())
  ON CONFLICT (id) DO UPDATE SET
    metrics = EXCLUDED.metrics,
    table_columns = EXCLUDED.table_columns,
    csv_columns = EXCLUDED.csv_columns,
    rank_metric_key = EXCLUDED.rank_metric_key,
    rank_direction = EXCLUDED.rank_direction,
    updated_at = now()
  RETURNING updated_at AS "updatedAt"
`;

const FIELD_SQL = Object.freeze({
  'city.population': 'population.population::double precision',
  'city.area_m2': 'boundary.area_m2',
  'geometry.length_m': 'geometry.length_m::double precision',
  'geometry.lane_length_m': 'geometry.lane_length_m::double precision',
  'geometry.lanes': 'geometry.lanes::double precision',
  'geometry.id': 'geometry.id',
});

const AGGREGATE_SQL = Object.freeze({
  sum: 'SUM',
  avg: 'AVG',
  min: 'MIN',
  max: 'MAX',
  count: 'COUNT',
});

function rowToConfig(row) {
  if (!row) throw new Error('Report configuration is missing; run database migrations');
  return validateReportConfig({
    metrics: row.metrics,
    tableColumns: row.tableColumns,
    csvColumns: row.csvColumns,
    rank: {
      metricKey: row.rankMetricKey,
      direction: row.rankDirection,
    },
    updatedAt: row.updatedAt instanceof Date
      ? row.updatedAt.toISOString()
      : row.updatedAt,
  });
}

function parameter(parameters, value) {
  parameters.push(value);
  return `$${parameters.length}`;
}

function compileOperand(operand, parameters) {
  if (operand.kind === 'constant') {
    return `${parameter(parameters, operand.value)}::double precision`;
  }
  if (operand.kind === 'metric') {
    const key = parameter(parameters, operand.metricKey);
    return `(SELECT CASE
      WHEN jsonb_typeof(dependency_report.values -> (${key}::text)) = 'number'
        THEN (dependency_report.values ->> (${key}::text))::double precision
      ELSE NULL
    END
    FROM city_report_values AS dependency_report
    WHERE dependency_report.city_id = city.id)`;
  }
  if (operand.kind === 'field') return FIELD_SQL[operand.field];

  const aggregate = AGGREGATE_SQL[operand.aggregate];
  const field = FIELD_SQL[operand.field];
  let expression = `${aggregate}(${field})`;
  if (operand.groupBy === 'line_type.name') {
    const value = parameter(parameters, operand.groupValue);
    expression += ` FILTER (
      WHERE LOWER(BTRIM(line_type.name)) = LOWER(BTRIM(${value}::text))
    )`;
  }
  if (operand.aggregate === 'sum' || operand.aggregate === 'count') {
    expression = `COALESCE(${expression}, 0)`;
  }
  return `(${expression})::double precision`;
}

function applyBinaryOperator(left, right, operator) {
  if (operator === 'add') return `(${left} + ${right})`;
  if (operator === 'subtract') return `(${left} - ${right})`;
  if (operator === 'multiply') return `(${left} * ${right})`;
  if (operator === 'divide') {
    return `(CASE WHEN ${right} IS NULL OR ${right} = 0 THEN NULL ELSE ${left} / ${right} END)`;
  }
  if (operator === 'percent') {
    return `(CASE WHEN ${right} IS NULL OR ${right} = 0 THEN NULL ELSE (${left} / ${right}) * 100.0 END)`;
  }
  throw new ReportConfigValidationError(`Unsupported arithmetic operator: ${operator}`);
}

function compileMetricExpression(metric, parameters) {
  const stack = [];
  for (const token of reportMetricToRpn(metric)) {
    if (token.kind === 'operand') {
      stack.push(compileOperand(token.operand, parameters));
      continue;
    }

    if (stack.length < 2) {
      throw new ReportConfigValidationError('Invalid report metric expression');
    }
    const right = stack.pop();
    const left = stack.pop();
    stack.push(applyBinaryOperator(left, right, token.operator));
  }

  if (stack.length !== 1) {
    throw new ReportConfigValidationError('Invalid report metric expression');
  }
  return stack[0];
}

/**
 * Compile one validated metric using only server-owned SQL fragments. User
 * values remain query parameters; field/table/aggregate identifiers never come
 * from request text. The editor's precedence levels are first converted to
 * Reverse Polish Notation, so explicit grouping is deterministic.
 */
export function compileReportMetricQuery(metric) {
  const parameters = [metric.key];
  const expression = compileMetricExpression(metric, parameters);

  return {
    text: `
      WITH metric_values AS (
        SELECT
          city.id AS city_id,
          ${expression} AS value
        FROM cities AS city
        LEFT JOIN city_populations AS population
          ON population.city_id = city.id
        LEFT JOIN (
          SELECT
            city_id,
            ST_Area(geom::geography)::double precision AS area_m2
          FROM city_boundaries
        ) AS boundary
          ON boundary.city_id = city.id
        LEFT JOIN city_geometries AS geometry
          ON geometry.city_id = city.id
        LEFT JOIN line_types AS line_type
          ON line_type.id = geometry.line_type_id
        GROUP BY city.id, population.population, boundary.area_m2
      )
      UPDATE city_report_values AS report
      SET
        values = jsonb_set(
          report.values,
          ARRAY[$1::text],
          COALESCE(to_jsonb(metric_values.value), 'null'::jsonb),
          true
        ),
        updated_at = now()
      FROM metric_values
      WHERE report.city_id = metric_values.city_id
    `,
    values: parameters,
  };
}

async function loadConfig(queryable) {
  const result = await queryable.query(LOAD_CONFIG_SQL);
  return rowToConfig(result.rows[0]);
}

async function materialize(queryable, config) {
  await queryable.query('DELETE FROM city_report_values');
  const inserted = await queryable.query(`
    INSERT INTO city_report_values (city_id, values, updated_at)
    SELECT id, '{}'::jsonb, now()
    FROM cities
    ORDER BY id
    RETURNING city_id
  `);

  const orderedMetrics = orderReportMetricsByDependencies(config.metrics);
  for (const metric of orderedMetrics) {
    const query = compileReportMetricQuery(metric);
    await queryable.query(query.text, query.values);
  }

  await queryable.query(
    `
      UPDATE city_report_values
      SET rank_value = CASE
        WHEN jsonb_typeof(values -> $1) = 'number'
          THEN (values ->> $1)::double precision
        ELSE NULL
      END,
      updated_at = now()
    `,
    [config.rank.metricKey],
  );

  const order = config.rank.direction === 'asc' ? 'ASC' : 'DESC';
  await queryable.query(`
    WITH ranked AS (
      SELECT
        report.city_id,
        ROW_NUMBER() OVER (
          PARTITION BY city.is_large
          ORDER BY report.rank_value ${order} NULLS LAST, city.name ASC
        )::integer AS rank
      FROM city_report_values AS report
      JOIN cities AS city ON city.id = report.city_id
    )
    UPDATE city_report_values AS report
    SET rank = ranked.rank,
        updated_at = now()
    FROM ranked
    WHERE ranked.city_id = report.city_id
  `);

  return {
    cities: inserted.rows.length,
    metrics: config.metrics.length,
    rankMetricKey: config.rank.metricKey,
    rankDirection: config.rank.direction,
  };
}

async function rollbackQuietly(client) {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Preserve the original failure if the connection itself is already gone.
  }
}

/** @param {{ connect: () => Promise<any>, databaseSchema?: string }} pool */
export function createReportConfigService(pool) {
  return {
    async get() {
      return loadConfig(pool);
    },

    async refresh() {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await acquireDataImportLock(client, pool);
        const config = await loadConfig(client);
        const result = await materialize(client, config);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await rollbackQuietly(client);
        throw error;
      } finally {
        client.release();
      }
    },

    async save(payload) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await acquireDataImportLock(client, pool);
        const lineTypes = await client.query('SELECT name FROM line_types ORDER BY id');
        const config = validateReportConfig(payload, {
          allowedLineTypeNames: lineTypes.rows.map((row) => row.name),
        });
        const saved = await client.query(SAVE_CONFIG_SQL, [
          JSON.stringify(config.metrics),
          JSON.stringify(config.tableColumns),
          JSON.stringify(config.csvColumns),
          config.rank.metricKey,
          config.rank.direction,
        ]);
        const updatedAt = saved.rows[0]?.updatedAt;
        const normalized = {
          ...config,
          updatedAt: updatedAt instanceof Date ? updatedAt.toISOString() : updatedAt,
        };
        const materialized = await materialize(client, normalized);
        await client.query('COMMIT');
        return { config: normalized, materialized };
      } catch (error) {
        await rollbackQuietly(client);
        throw error;
      } finally {
        client.release();
      }
    },
  };
}