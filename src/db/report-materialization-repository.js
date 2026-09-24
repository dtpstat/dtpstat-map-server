import {
  orderReportMetricsByDependencies,
} from '../modules/reporting/config-policy.js';
import {
  compileReportMetricQuery,
  compileReportRankQuery,
} from '../modules/reporting/query-compiler.js';

export async function materializeReportValues(client, config) {
  await client.query('DELETE FROM city_report_values');
  const inserted = await client.query(`
    INSERT INTO city_report_values (city_id, values, updated_at)
    SELECT city.id, '{}'::jsonb, now()
    FROM cities AS city
    WHERE EXISTS (
      SELECT 1
      FROM city_boundaries AS boundary_presence
      WHERE boundary_presence.city_id = city.id
        AND boundary_presence.is_active
    )
      AND EXISTS (
        SELECT 1
        FROM city_geometries AS geometry_presence
        JOIN city_boundaries AS geometry_boundary
          ON geometry_boundary.id = geometry_presence.boundary_id
         AND geometry_boundary.is_active
        WHERE geometry_presence.city_id = city.id
      )
    ORDER BY city.id
    RETURNING city_id
  `);

  const orderedMetrics =
    orderReportMetricsByDependencies(config.metrics);
  for (const metric of orderedMetrics) {
    const query = compileReportMetricQuery(metric);
    await client.query(query.text, query.values);
  }

  const primaryRank = config.rank.sort[0];
  await client.query(
    `
      UPDATE city_report_values
      SET rank_value = CASE
        WHEN jsonb_typeof(values -> $1) = 'number'
          THEN (values ->> $1)::double precision
        ELSE NULL
      END,
      updated_at = now()
    `,
    [primaryRank.metricKey],
  );

  const rankQuery = compileReportRankQuery(config.rank);
  await client.query(rankQuery.text, rankQuery.values);

  return {
    cities: inserted.rows.length,
    metrics: config.metrics.length,
    rankSort: config.rank.sort,
    rankMetricKey: primaryRank.metricKey,
    rankDirection: primaryRank.direction,
  };
}
