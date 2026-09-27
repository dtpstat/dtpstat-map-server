import {
  reportMetricToRpn,
  ReportConfigValidationError,
} from './config-policy.js';

const FIELD_SQL = Object.freeze({
  'city.population': 'population.population::double precision',
  'city.area_m2': `(SELECT city_boundary.area_m2::double precision
    FROM city_boundaries AS city_boundary
    WHERE city_boundary.city_id = city.id
      AND city_boundary.is_active
    ORDER BY city_boundary.area_m2 DESC
    LIMIT 1)`,
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

  const field = FIELD_SQL[operand.field];
  let expression;
  if (operand.aggregate === 'median') {
    expression = `PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${field})`;
  } else {
    const aggregate = AGGREGATE_SQL[operand.aggregate];
    expression = `${aggregate}(${field})`;
  }
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
  throw new ReportConfigValidationError(
    `Unsupported arithmetic operator: ${operator}`,
  );
}

function compileMetricExpression(metric, parameters) {
  const stack = [];
  for (const token of reportMetricToRpn(metric)) {
    if (token.kind === 'operand') {
      stack.push(compileOperand(token.operand, parameters));
      continue;
    }

    if (stack.length < 2) {
      throw new ReportConfigValidationError(
        'Invalid report metric expression',
      );
    }
    const right = stack.pop();
    const left = stack.pop();
    stack.push(
      applyBinaryOperator(left, right, token.operator),
    );
  }

  if (stack.length !== 1) {
    throw new ReportConfigValidationError(
      'Invalid report metric expression',
    );
  }
  return stack[0];
}

/**
 * Compile one validated metric using only server-owned SQL fragments. User
 * values remain query parameters; field/table/aggregate identifiers never come
 * from request text.
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
        LEFT JOIN city_geometries AS geometry
          ON geometry.city_id = city.id
         AND EXISTS (
           SELECT 1
           FROM city_boundaries AS metric_boundary
           WHERE metric_boundary.id = geometry.boundary_id
             AND metric_boundary.is_active
         )
        LEFT JOIN line_types AS line_type
          ON line_type.id = geometry.line_type_id
        GROUP BY city.id, population.population
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

/**
 * Build deterministic sequential ranking SQL.
 */
export function compileReportRankQuery(rank) {
  const parameters = [];
  const order = rank.sort.map((criterion, index) => {
    const direction =
      criterion.direction === 'asc' ? 'ASC' : 'DESC';
    if (index === 0) {
      return `report.rank_value ${direction} NULLS LAST`;
    }
    const key = parameter(parameters, criterion.metricKey);
    return `(CASE
      WHEN jsonb_typeof(report.values -> (${key}::text)) = 'number'
        THEN (report.values ->> (${key}::text))::double precision
      ELSE NULL
    END) ${direction} NULLS LAST`;
  });
  order.push('city.name ASC');

  return {
    text: `
      WITH ranked AS (
        SELECT
          report.city_id,
          CASE
            WHEN report.rank_value IS NULL THEN NULL
            ELSE ROW_NUMBER() OVER (
              PARTITION BY COALESCE(city.is_large, FALSE)
              ORDER BY ${order.join(',\n                       ')}
            )::integer
          END AS rank
        FROM city_report_values AS report
        JOIN cities AS city ON city.id = report.city_id
      )
      UPDATE city_report_values AS report
      SET rank = ranked.rank,
          updated_at = now()
      FROM ranked
      WHERE ranked.city_id = report.city_id
    `,
    values: parameters,
  };
}
