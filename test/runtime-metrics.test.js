import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createRuntimeMetrics,
} from '../src/observability/runtime-metrics.js';

test('runtime metrics expose HTTP process and PostgreSQL pool measurements', () => {
  const metrics =
    createRuntimeMetrics({
      pool: {
        totalCount: 7,
        idleCount: 4,
        waitingCount: 2,
        options: {
          max: 10,
        },
      },
      processRef: {
        uptime() {
          return 123.5;
        },
        memoryUsage() {
          return {
            rss:
              104857600,
            heapUsed:
              33554432,
          };
        },
      },
    });

  metrics.observeHttpRequest({
    method: 'get',
    route:
      '/api/cities/:cityId/geometries',
    statusCode: 200,
    durationMs: 12,
  });
  metrics.observeHttpRequest({
    method: 'GET',
    route:
      '/api/cities/:cityId/geometries',
    statusCode: 200,
    durationMs: 40,
  });
  metrics.observeHttpRequest({
    method: 'POST',
    route:
      '/api/admin/test',
    statusCode: 503,
    durationMs: 600,
  });

  const output =
    metrics.render();

  assert.match(
    output,
    /dtpstat_http_requests_total\{method="GET",route="\/api\/cities\/:cityId\/geometries",status_code="200"\} 2/u,
  );
  assert.match(
    output,
    /dtpstat_http_request_duration_seconds_bucket\{method="GET",route="\/api\/cities\/:cityId\/geometries",status_code="200",le="0\.025"\} 1/u,
  );
  assert.match(
    output,
    /dtpstat_http_request_duration_seconds_bucket\{method="GET",route="\/api\/cities\/:cityId\/geometries",status_code="200",le="0\.05"\} 2/u,
  );
  assert.match(
    output,
    /dtpstat_http_request_duration_seconds_count\{method="GET",route="\/api\/cities\/:cityId\/geometries",status_code="200"\} 2/u,
  );
  assert.match(
    output,
    /dtpstat_process_uptime_seconds 123\.5/u,
  );
  assert.match(
    output,
    /dtpstat_process_resident_memory_bytes 104857600/u,
  );
  assert.match(
    output,
    /dtpstat_db_pool_connections\{state="total"\} 7/u,
  );
  assert.match(
    output,
    /dtpstat_db_pool_connections\{state="waiting"\} 2/u,
  );
  assert.match(
    output,
    /dtpstat_db_pool_max_connections 10/u,
  );
});
