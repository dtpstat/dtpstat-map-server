import assert from 'node:assert/strict';
import {
  EventEmitter,
} from 'node:events';
import test from 'node:test';
import {
  createApiRequestObservability,
  normalizeRequestId,
  REQUEST_ID_HEADER,
} from '../src/http/request-observability.js';

function createResponse() {
  const response =
    new EventEmitter();
  response.statusCode =
    200;
  response.writableEnded =
    false;
  response.headers =
    new Map();
  response.set =
    (
      name,
      value,
    ) => {
      response.headers.set(
        String(name)
          .toLowerCase(),
        String(value),
      );
    };
  return response;
}

test('request observability validates correlation identifiers', () => {
  assert.equal(
    normalizeRequestId(
      'trace.test-123',
    ),
    'trace.test-123',
  );
  assert.equal(
    normalizeRequestId(
      ' bad ',
    ),
    'bad',
  );
  assert.equal(
    normalizeRequestId(
      'bad request id',
    ),
    null,
  );
  assert.equal(
    normalizeRequestId(
      'x'.repeat(
        129,
      ),
    ),
    null,
  );
});

test('request observability logs API completion without query data', () => {
  const entries = [];
  const times = [
    100,
    112.345,
  ];
  const request = {
    path:
      '/api/geometries',
    originalUrl:
      '/api/geometries?bbox=secret',
    method:
      'GET',
    baseUrl:
      '/api',
    route: {
      path:
        '/geometries',
    },
    get(name) {
      return name ===
        REQUEST_ID_HEADER
        ? 'trace-1'
        : undefined;
    },
  };
  const response =
    createResponse();
  let nextCalls = 0;

  const middleware =
    createApiRequestObservability({
      now:
        () =>
          times.shift(),
      createRequestId:
        () =>
          'generated-id',
      log(
        level,
        event,
        details,
      ) {
        entries.push({
          level,
          event,
          details,
        });
      },
    });

  middleware(
    request,
    response,
    () => {
      nextCalls += 1;
    },
  );
  response.writableEnded =
    true;
  response.emit(
    'finish',
  );

  assert.equal(
    nextCalls,
    1,
  );
  assert.equal(
    request.requestId,
    'trace-1',
  );
  assert.equal(
    response.headers.get(
      'x-request-id',
    ),
    'trace-1',
  );
  assert.deepEqual(
    entries,
    [
      {
        level:
          'info',
        event:
          'http.request',
        details: {
          requestId:
            'trace-1',
          method:
            'GET',
          path:
            '/api/geometries',
          statusCode:
            200,
          durationMs:
            12.345,
        },
      },
    ],
  );
  assert.equal(
    JSON.stringify(
      entries,
    ).includes(
      'bbox=secret',
    ),
    false,
  );
});

test('request observability marks failed and aborted API requests', () => {
  const entries = [];
  const times = [
    10,
    15,
    20,
    25,
  ];
  const middleware =
    createApiRequestObservability({
      now:
        () =>
          times.shift(),
      createRequestId:
        () =>
          'generated-id',
      log(
        level,
        event,
        details,
      ) {
        entries.push({
          level,
          event,
          details,
        });
      },
    });

  const failedRequest = {
    path:
      '/api/failure',
    originalUrl:
      '/api/failure',
    method:
      'GET',
    get() {
      return undefined;
    },
  };
  const failedResponse =
    createResponse();
  failedResponse.statusCode =
    503;

  middleware(
    failedRequest,
    failedResponse,
    () => {},
  );
  failedResponse.writableEnded =
    true;
  failedResponse.emit(
    'finish',
  );

  const abortedRequest = {
    path:
      '/api/stream',
    originalUrl:
      '/api/stream',
    method:
      'GET',
    get() {
      return undefined;
    },
  };
  const abortedResponse =
    createResponse();

  middleware(
    abortedRequest,
    abortedResponse,
    () => {},
  );
  abortedResponse.emit(
    'close',
  );

  assert.equal(
    entries[0].level,
    'error',
  );
  assert.equal(
    entries[0]
      .details
      .statusCode,
    503,
  );
  assert.equal(
    entries[1].level,
    'warning',
  );
  assert.equal(
    entries[1]
      .details
      .aborted,
    true,
  );
});


test('request observability records bounded-route HTTP metrics', () => {
  const observations = [];
  const times = [
    100,
    125,
  ];
  const middleware =
    createApiRequestObservability({
      now:
        () =>
          times.shift(),
      createRequestId:
        () =>
          'generated-id',
      metrics: {
        observeHttpRequest(
          details,
        ) {
          observations.push(
            details,
          );
        },
      },
      log() {},
    });
  const request = {
    path:
      '/api/cities/42/geometries',
    originalUrl:
      '/api/cities/42/geometries?secret=value',
    method:
      'GET',
    route: {
      path:
        '/cities/:cityId/geometries',
    },
    get() {
      return undefined;
    },
  };
  const response =
    createResponse();

  middleware(
    request,
    response,
    () => {},
  );
  response.writableEnded =
    true;
  response.emit(
    'finish',
  );

  assert.deepEqual(
    observations,
    [
      {
        method:
          'GET',
        route:
          '/api/cities/:cityId/geometries',
        statusCode:
          200,
        durationMs:
          25,
      },
    ],
  );
});
