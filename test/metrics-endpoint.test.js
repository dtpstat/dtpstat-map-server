import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import test from 'node:test';
import {
  installMetricsEndpoint,
} from '../src/http/metrics-endpoint.js';

async function withMetricsServer(
  authorizeMetricsToken,
  callback,
) {
  const app =
    express();

  installMetricsEndpoint(
    app,
    {
      securityService: {
        authorizeMetricsToken,
      },
      metrics: {
        render() {
          return (
            '# TYPE test_metric gauge\n' +
            'test_metric 1\n'
          );
        },
      },
    },
  );

  const server =
    http.createServer(
      app,
    );

  await new Promise(
    (resolve) =>
      server.listen(
        0,
        '127.0.0.1',
        resolve,
      ),
  );
  const address =
    server.address();

  try {
    await callback(
      'http://127.0.0.1:' +
        address.port,
    );
  } finally {
    await new Promise(
      (
        resolve,
        reject,
      ) =>
        server.close(
          (error) =>
            error
              ? reject(
                  error,
                )
              : resolve(),
        ),
    );
  }
}

test('metrics endpoint stays hidden while DB setting is disabled', async () => {
  await withMetricsServer(
    async () => ({
      enabled: false,
      authorized: false,
    }),
    async (baseUrl) => {
      const response =
        await fetch(
          baseUrl +
            '/metrics',
        );

      assert.equal(
        response.status,
        404,
      );
    },
  );
});

test('metrics endpoint requires the DB-backed bearer token', async () => {
  const received = [];

  await withMetricsServer(
    async (token) => {
      received.push(
        token,
      );
      return {
        enabled: true,
        authorized:
          token ===
          'correct-token',
      };
    },
    async (baseUrl) => {
      const unauthorized =
        await fetch(
          baseUrl +
            '/metrics',
        );

      assert.equal(
        unauthorized.status,
        401,
      );
      assert.equal(
        unauthorized.headers.get(
          'www-authenticate',
        ),
        'Bearer realm="metrics"',
      );

      const response =
        await fetch(
          baseUrl +
            '/metrics',
          {
            headers: {
              Authorization:
                'Bearer correct-token',
            },
          },
        );

      assert.equal(
        response.status,
        200,
      );
      const contentType =
        response.headers.get(
          'content-type',
        ) ?? '';
      assert.match(
        contentType,
        /^text\/plain(?:;|$)/u,
      );
      assert.match(
        contentType,
        /charset=utf-8/u,
      );
      assert.match(
        contentType,
        /version=0\.0\.4/u,
      );
      assert.equal(
        response.headers.get(
          'cache-control',
        ),
        'no-store',
      );
      assert.match(
        await response.text(),
        /test_metric 1/u,
      );
    },
  );

  assert.deepEqual(
    received,
    [
      null,
      'correct-token',
    ],
  );
});
