import 'dotenv/config';
import path from 'node:path';
import {
  fileURLToPath,
} from 'node:url';
import {
  createDatabaseClient,
} from './database.js';
import {
  loadDatabaseSchema,
} from '../src/db/database-environment.js';
import {
  verifyDatabaseMigrationState,
} from '../src/db/migration-state.js';
import {
  viewportGeometryQuery,
} from '../src/db/viewport-query.js';

const DEFAULT_ITERATIONS = 5;
const MAX_ITERATIONS = 50;

const projectRoot =
  path.resolve(
    path.dirname(
      fileURLToPath(
        import.meta.url,
      ),
    ),
    '..',
  );

function optionValue(
  name,
) {
  const prefix =
    `--${name}=`;
  const match =
    process.argv
      .slice(2)
      .find(
        (argument) =>
          argument.startsWith(
            prefix,
          ),
      );

  return match
    ? match.slice(
        prefix.length,
      )
    : null;
}

function numericList(
  value,
  expectedLength,
  label,
) {
  const parts =
    value
      ?.split(',')
      .map(Number);

  if (
    !parts ||
    parts.length !==
      expectedLength ||
    parts.some(
      (item) =>
        !Number.isFinite(
          item,
        ),
    )
  ) {
    throw new Error(
      `${label} must contain ${expectedLength} comma-separated numbers`,
    );
  }

  return parts;
}

function viewportFromArguments() {
  const bbox =
    numericList(
      optionValue(
        'bbox',
      ),
      4,
      '--bbox',
    );

  const [
    west,
    south,
    east,
    north,
  ] = bbox;

  if (
    west < -180 ||
    east > 180 ||
    south < -90 ||
    north > 90 ||
    west >= east ||
    south >= north ||
    east - west > 20 ||
    north - south > 20
  ) {
    throw new Error(
      '--bbox must match the public WGS84 viewport contract and span at most 20 degrees',
    );
  }

  const centerValue =
    optionValue(
      'center',
    );
  const center =
    centerValue
      ? numericList(
          centerValue,
          2,
          '--center',
        )
      : [
          (west + east) / 2,
          (south + north) / 2,
        ];

  if (
    center[0] < west ||
    center[0] > east ||
    center[1] < south ||
    center[1] > north
  ) {
    throw new Error(
      '--center must be inside --bbox',
    );
  }

  return {
    west,
    south,
    east,
    north,
    centerLng:
      center[0],
    centerLat:
      center[1],
  };
}

function iterationsFromArguments() {
  const raw =
    optionValue(
      'iterations',
    );

  if (raw === null) {
    return DEFAULT_ITERATIONS;
  }

  const value =
    Number(raw);

  if (
    !Number.isInteger(
      value,
    ) ||
    value < 1 ||
    value > MAX_ITERATIONS
  ) {
    throw new Error(
      `--iterations must be an integer from 1 to ${MAX_ITERATIONS}`,
    );
  }

  return value;
}

function percentile(
  values,
  fraction,
) {
  const ordered =
    [...values].sort(
      (
        left,
        right,
      ) =>
        left - right,
    );
  const index =
    Math.max(
      0,
      Math.ceil(
        ordered.length *
          fraction,
      ) - 1,
    );

  return ordered[index];
}

function round(
  value,
) {
  return Number(
    value.toFixed(3),
  );
}

function planSummary(
  explain,
) {
  const scans = [];
  const sequentialScans = [];
  const timedNodes = [];

  function nodeMetrics(
    plan,
  ) {
    const actualLoops =
      Number(
        plan[
          'Actual Loops'
        ] ?? 0,
      );
    const averageTotalMs =
      Number(
        plan[
          'Actual Total Time'
        ] ?? 0,
      );

    return {
      nodeType:
        plan[
          'Node Type'
        ],
      relation:
        plan[
          'Relation Name'
        ] ??
        null,
      index:
        plan[
          'Index Name'
        ] ??
        null,
      planRows:
        Number(
          plan[
            'Plan Rows'
          ] ?? 0,
        ),
      actualRows:
        Number(
          plan[
            'Actual Rows'
          ] ?? 0,
        ),
      actualLoops,
      averageTotalMs:
        round(
          averageTotalMs,
        ),
      inclusiveTotalMs:
        round(
          averageTotalMs *
            actualLoops,
        ),
      rowsRemovedByFilter:
        Number(
          plan[
            'Rows Removed by Filter'
          ] ?? 0,
        ),
      sharedHitBlocks:
        Number(
          plan[
            'Shared Hit Blocks'
          ] ?? 0,
        ),
      sharedReadBlocks:
        Number(
          plan[
            'Shared Read Blocks'
          ] ?? 0,
        ),
    };
  }

  function visit(plan) {
    if (!plan) {
      return;
    }

    const metrics =
      nodeMetrics(
        plan,
      );

    timedNodes.push(
      metrics,
    );

    if (
      plan[
        'Index Name'
      ]
    ) {
      scans.push(
        metrics,
      );
    }

    if (
      plan[
        'Node Type'
      ] ===
      'Seq Scan'
    ) {
      sequentialScans.push(
        metrics,
      );
    }

    for (
      const child of
      plan.Plans ?? []
    ) {
      visit(child);
    }
  }

  visit(explain.Plan);

  return {
    planningMs:
      round(
        explain[
          'Planning Time'
        ],
      ),
    executionMs:
      round(
        explain[
          'Execution Time'
        ],
      ),
    root: {
      actualRows:
        Number(
          explain.Plan[
            'Actual Rows'
          ] ?? 0,
        ),
      actualLoops:
        Number(
          explain.Plan[
            'Actual Loops'
          ] ?? 0,
        ),
      actualTotalMs:
        round(
          Number(
            explain.Plan[
              'Actual Total Time'
            ] ?? 0,
          ),
        ),
      sharedHitBlocks:
        Number(
          explain.Plan[
            'Shared Hit Blocks'
          ] ?? 0,
        ),
      sharedReadBlocks:
        Number(
          explain.Plan[
            'Shared Read Blocks'
          ] ?? 0,
        ),
      tempReadBlocks:
        Number(
          explain.Plan[
            'Temp Read Blocks'
          ] ?? 0,
        ),
      tempWrittenBlocks:
        Number(
          explain.Plan[
            'Temp Written Blocks'
          ] ?? 0,
        ),
    },
    hotNodes:
      timedNodes
        .sort(
          (
            left,
            right,
          ) =>
            right
              .inclusiveTotalMs -
            left
              .inclusiveTotalMs,
        )
        .slice(
          0,
          10,
        ),
    indexScans:
      scans,
    sequentialScans,
  };
}

async function main() {
  const viewport =
    viewportFromArguments();
  const iterations =
    iterationsFromArguments();
  const query =
    viewportGeometryQuery(
      viewport,
    );
  const client =
    createDatabaseClient();
  const timings = [];

  await client.connect();

  try {
    const migrationState =
      await verifyDatabaseMigrationState(
        client,
        {
          projectRoot,
          schema:
            loadDatabaseSchema(),
        },
      );

    await client.query(
      'BEGIN READ ONLY',
    );
    await client.query(
      query.text,
      query.values,
    );

    let sample = null;

    for (
      let index = 0;
      index < iterations;
      index += 1
    ) {
      const started =
        process
          .hrtime
          .bigint();
      const result =
        await client.query(
          query.text,
          query.values,
        );
      const elapsed =
        Number(
          process
            .hrtime
            .bigint() -
            started,
        ) /
        1_000_000;

      timings.push(
        elapsed,
      );
      sample =
        result.rows[0]
          ?.geojson ??
        null;
    }

    const explained =
      await client.query(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query.text}`,
        query.values,
      );
    const explain =
      explained.rows[0]
        ['QUERY PLAN'][0];

    console.log(
      JSON.stringify(
        {
          database:
            client.database,
          runtimeRole:
            client.user,
          migrationState,
          viewport,
          selector:
            query.selector,
          iterations,
          latencyMs: {
            min:
              round(
                Math.min(
                  ...timings,
                ),
              ),
            p50:
              round(
                percentile(
                  timings,
                  0.5,
                ),
              ),
            p95:
              round(
                percentile(
                  timings,
                  0.95,
                ),
              ),
            max:
              round(
                Math.max(
                  ...timings,
                ),
              ),
          },
          result: {
            features:
              sample
                ?.features
                ?.length ??
              0,
            bytes:
              Buffer.byteLength(
                JSON.stringify(
                  sample,
                ),
                'utf8',
              ),
          },
          plan:
            planSummary(
              explain,
            ),
        },
        null,
        2,
      ),
    );

    await client.query(
      'ROLLBACK',
    );
  } catch (error) {
    await client.query(
      'ROLLBACK',
    ).catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

main().catch(
  (error) => {
    console.error(
      'Viewport performance profile failed',
      error,
    );
    process.exitCode =
      1;
  },
);
