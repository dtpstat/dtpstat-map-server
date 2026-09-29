const HTTP_DURATION_BUCKETS_SECONDS =
  Object.freeze([
    0.005,
    0.01,
    0.025,
    0.05,
    0.1,
    0.25,
    0.5,
    1,
    2.5,
    5,
    10,
    30,
  ]);

function labelValue(
  value,
) {
  return String(
    value,
  )
    .replaceAll(
      '\\',
      '\\\\',
    )
    .replaceAll(
      '\n',
      '\\n',
    )
    .replaceAll(
      '"',
      '\\"',
    );
}

function labelsText(
  labels,
) {
  const entries =
    Object.entries(
      labels,
    );

  if (
    entries.length ===
    0
  ) {
    return '';
  }

  return (
    '{' +
    entries
      .map(
        (
          [
            name,
            value,
          ],
        ) =>
          `${name}="${labelValue(
            value,
          )}"`,
      )
      .join(',') +
    '}'
  );
}

function metricNumber(
  value,
) {
  const numeric =
    Number(
      value,
    );

  return Number.isFinite(
    numeric,
  )
    ? String(
        numeric,
      )
    : '0';
}

function requestKey(
  {
    method,
    route,
    statusCode,
  },
) {
  return JSON.stringify([
    method,
    route,
    statusCode,
  ]);
}

function requestLabels(
  record,
) {
  return {
    method:
      record.method,
    route:
      record.route,
    status_code:
      record.statusCode,
  };
}

export function createRuntimeMetrics(
  {
    pool = null,
    processRef = process,
  } = {},
) {
  const requests =
    new Map();

  function observeHttpRequest(
    {
      method,
      route,
      statusCode,
      durationMs,
    },
  ) {
    const safeMethod =
      String(
        method ??
        'UNKNOWN',
      )
        .toUpperCase()
        .slice(
          0,
          16,
        );
    const safeRoute =
      String(
        route ??
        '__unmatched__',
      )
        .slice(
          0,
          256,
        );
    const safeStatusCode =
      Number.isInteger(
        statusCode,
      )
        ? statusCode
        : 0;
    const durationSeconds =
      Math.max(
        0,
        Number(
          durationMs,
        ) || 0,
      ) /
      1000;
    const key =
      requestKey({
        method:
          safeMethod,
        route:
          safeRoute,
        statusCode:
          safeStatusCode,
      });
    let record =
      requests.get(
        key,
      );

    if (!record) {
      record = {
        method:
          safeMethod,
        route:
          safeRoute,
        statusCode:
          safeStatusCode,
        count: 0,
        durationSecondsSum:
          0,
        buckets:
          HTTP_DURATION_BUCKETS_SECONDS
            .map(
              () =>
                0,
            ),
      };
      requests.set(
        key,
        record,
      );
    }

    record.count +=
      1;
    record
      .durationSecondsSum +=
      durationSeconds;

    for (
      let index = 0;
      index <
        HTTP_DURATION_BUCKETS_SECONDS
          .length;
      index += 1
    ) {
      if (
        durationSeconds <=
        HTTP_DURATION_BUCKETS_SECONDS[
          index
        ]
      ) {
        record.buckets[
          index
        ] +=
          1;
      }
    }
  }

  function render() {
    const lines = [
      '# HELP dtpstat_http_requests_total Completed HTTP API requests.',
      '# TYPE dtpstat_http_requests_total counter',
    ];
    const ordered =
      [
        ...requests
          .values(),
      ].sort(
        (
          left,
          right,
        ) =>
          requestKey(
            left,
          )
            .localeCompare(
              requestKey(
                right,
              ),
            ),
      );

    for (
      const record of
      ordered
    ) {
      lines.push(
        'dtpstat_http_requests_total' +
          labelsText(
            requestLabels(
              record,
            ),
          ) +
          ' ' +
          record.count,
      );
    }

    lines.push(
      '# HELP dtpstat_http_request_duration_seconds HTTP API request duration.',
      '# TYPE dtpstat_http_request_duration_seconds histogram',
    );

    for (
      const record of
      ordered
    ) {
      const labels =
        requestLabels(
          record,
        );

      for (
        let index = 0;
        index <
          HTTP_DURATION_BUCKETS_SECONDS
            .length;
        index += 1
      ) {
        lines.push(
          'dtpstat_http_request_duration_seconds_bucket' +
            labelsText({
              ...labels,
              le:
                HTTP_DURATION_BUCKETS_SECONDS[
                  index
                ],
            }) +
            ' ' +
            record.buckets[
              index
            ],
        );
      }

      lines.push(
        'dtpstat_http_request_duration_seconds_bucket' +
          labelsText({
            ...labels,
            le:
              '+Inf',
          }) +
          ' ' +
          record.count,
        'dtpstat_http_request_duration_seconds_sum' +
          labelsText(
            labels,
          ) +
          ' ' +
          metricNumber(
            record
              .durationSecondsSum,
          ),
        'dtpstat_http_request_duration_seconds_count' +
          labelsText(
            labels,
          ) +
          ' ' +
          record.count,
      );
    }

    const memory =
      processRef
        .memoryUsage();

    lines.push(
      '# HELP dtpstat_process_uptime_seconds Node.js process uptime.',
      '# TYPE dtpstat_process_uptime_seconds gauge',
      'dtpstat_process_uptime_seconds ' +
        metricNumber(
          processRef
            .uptime(),
        ),
      '# HELP dtpstat_process_resident_memory_bytes Resident memory size.',
      '# TYPE dtpstat_process_resident_memory_bytes gauge',
      'dtpstat_process_resident_memory_bytes ' +
        metricNumber(
          memory.rss,
        ),
      '# HELP dtpstat_process_heap_used_bytes Node.js heap bytes in use.',
      '# TYPE dtpstat_process_heap_used_bytes gauge',
      'dtpstat_process_heap_used_bytes ' +
        metricNumber(
          memory.heapUsed,
        ),
    );

    if (pool) {
      lines.push(
        '# HELP dtpstat_db_pool_connections PostgreSQL pool connections by state.',
        '# TYPE dtpstat_db_pool_connections gauge',
        'dtpstat_db_pool_connections' +
          labelsText({
            state:
              'total',
          }) +
          ' ' +
          metricNumber(
            pool.totalCount,
          ),
        'dtpstat_db_pool_connections' +
          labelsText({
            state:
              'idle',
          }) +
          ' ' +
          metricNumber(
            pool.idleCount,
          ),
        'dtpstat_db_pool_connections' +
          labelsText({
            state:
              'waiting',
          }) +
          ' ' +
          metricNumber(
            pool.waitingCount,
          ),
        '# HELP dtpstat_db_pool_max_connections Configured PostgreSQL pool maximum.',
        '# TYPE dtpstat_db_pool_max_connections gauge',
        'dtpstat_db_pool_max_connections ' +
          metricNumber(
            pool.options
              ?.max,
          ),
      );
    }

    return (
      lines.join(
        '\n',
      ) +
      '\n'
    );
  }

  return {
    observeHttpRequest,
    render,
  };
}
