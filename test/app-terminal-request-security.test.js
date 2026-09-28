import assert from 'node:assert/strict';
import test from 'node:test';
import {
  installAppTerminalHandlers,
} from '../src/http/app-terminal-handlers.js';

function response() {
  return {
    statusCode: 200,
    body: null,
    status(value) {
      this.statusCode =
        value;
      return this;
    },
    json(value) {
      this.body =
        value;
      return this;
    },
    type() {
      return this;
    },
    send(value) {
      this.body =
        value;
      return this;
    },
  };
}

function installedHandlers() {
  const handlers = [];
  installAppTerminalHandlers({
    use(handler) {
      handlers.push(handler);
    },
  });
  return handlers;
}

test('terminal handler logs malformed JSON and oversized admin bodies', () => {
  const [, errorHandler] =
    installedHandlers();
  const incidents = [];
  const request = {
    method: 'POST',
    path:
      '/admin/geometry-editor/sync',
    originalUrl:
      '/api/admin/geometry-editor/sync',
    recordAdminSecurityIncident(
      event,
      details,
    ) {
      incidents.push({
        event,
        details,
      });
    },
  };

  const invalidJson =
    response();
  errorHandler(
    {
      type:
        'entity.parse.failed',
    },
    request,
    invalidJson,
    () => {},
  );

  assert.equal(
    invalidJson.statusCode,
    400,
  );
  assert.deepEqual(
    incidents[0],
    {
      event:
        'admin.request.rejected',
      details: {
        statusCode: 400,
        reason:
          'invalid-json',
      },
    },
  );

  incidents.length = 0;
  const tooLarge =
    response();
  errorHandler(
    {
      type:
        'entity.too.large',
    },
    request,
    tooLarge,
    () => {},
  );

  assert.equal(
    tooLarge.statusCode,
    413,
  );
  assert.equal(
    incidents[0]
      .details.reason,
    'request-body-too-large',
  );
});

test('terminal handler logs an unknown admin API endpoint', () => {
  const [notFound] =
    installedHandlers();
  const incidents = [];
  const request = {
    method: 'GET',
    path:
      '/api/admin/not-real',
    originalUrl:
      '/api/admin/not-real',
    recordAdminSecurityIncident(
      event,
      details,
    ) {
      incidents.push({
        event,
        details,
      });
    },
  };
  const res =
    response();

  notFound(
    request,
    res,
  );

  assert.equal(
    res.statusCode,
    404,
  );
  assert.equal(
    incidents[0].event,
    'admin.request.rejected',
  );
  assert.equal(
    incidents[0]
      .details.reason,
    'api-endpoint-not-found',
  );
});
