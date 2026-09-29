import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import {
  fileURLToPath,
} from 'node:url';
import {
  installAppHttpMiddleware,
} from '../src/http/app-middleware.js';
import {
  adminNoStoreHeaders,
} from '../src/http/security-headers.js';

const projectRoot =
  path.resolve(
    path.dirname(
      fileURLToPath(
        import.meta.url,
      ),
    ),
    '..',
  );

function pass(
  _request,
  _response,
  next,
) {
  next();
}

async function withHeaderServer(
  config,
  callback,
) {
  const app = express();

  installAppHttpMiddleware(
    app,
    {
      config: {
        projectRoot,
        admin: {
          allowedOrigins:
            new Set(),
        },
        http: {
          trustProxyHops:
            0,
        },
        ...config,
      },
      adminAuth: {
        limitGlobalRequest:
          pass,
        requireAdminEntry:
          pass,
      },
      securityService: {},
    },
  );

  app.get(
    '/probe',
    (_request, response) => {
      response
        .type('text/plain')
        .send('public');
    },
  );

  app.get(
    '/admin/probe',
    (_request, response) => {
      response
        .type('text/plain')
        .send('admin');
    },
  );

  const server =
    http.createServer(app);

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
      `http://127.0.0.1:${address.port}`,
    );
  } finally {
    await new Promise(
      (resolve, reject) =>
        server.close(
          (error) =>
            error
              ? reject(error)
              : resolve(),
        ),
    );
  }
}

test('security headers keep public and admin framing policies separate', async () => {
  await withHeaderServer(
    {
      environment: 'test',
    },
    async (baseUrl) => {
      const publicResponse =
        await fetch(
          `${baseUrl}/probe`,
        );
      const adminResponse =
        await fetch(
          `${baseUrl}/admin/probe`,
        );

      assert.equal(
        publicResponse.headers.get(
          'strict-transport-security',
        ),
        null,
      );
      assert.equal(
        publicResponse.headers.get(
          'x-content-type-options',
        ),
        'nosniff',
      );
      assert.equal(
        publicResponse.headers.get(
          'referrer-policy',
        ),
        'no-referrer',
      );
      assert.equal(
        publicResponse.headers.get(
          'x-frame-options',
        ),
        'SAMEORIGIN',
      );
      assert.match(
        publicResponse.headers.get(
          'content-security-policy',
        ) ?? '',
        /frame-ancestors[^;]*'self'/u,
      );

      assert.equal(
        adminResponse.headers.get(
          'x-frame-options',
        ),
        'DENY',
      );
      assert.match(
        adminResponse.headers.get(
          'content-security-policy',
        ) ?? '',
        /frame-ancestors 'none'/u,
      );
      assert.match(
        adminResponse.headers.get(
          'content-security-policy',
        ) ?? '',
        /object-src 'none'/u,
      );
    },
  );
});

test('production HSTS follows the effective HTTPS request behind a trusted proxy', async () => {
  await withHeaderServer(
    {
      environment:
        'production',
      http: {
        trustProxyHops: 1,
      },
    },
    async (baseUrl) => {
      const secure =
        await fetch(
          `${baseUrl}/probe`,
          {
            headers: {
              'X-Forwarded-Proto':
                'https',
            },
          },
        );
      const insecure =
        await fetch(
          `${baseUrl}/probe`,
        );

      assert.equal(
        secure.headers.get(
          'strict-transport-security',
        ),
        'max-age=31536000',
      );
      assert.equal(
        insecure.headers.get(
          'strict-transport-security',
        ),
        null,
      );
    },
  );
});

test('admin API no-store policy is centralized', () => {
  const headers =
    new Map();
  let continued =
    false;

  adminNoStoreHeaders(
    {},
    {
      set(name, value) {
        headers.set(
          name.toLowerCase(),
          value,
        );
        return this;
      },
    },
    () => {
      continued = true;
    },
  );

  assert.equal(
    headers.get(
      'cache-control',
    ),
    'no-store',
  );
  assert.equal(
    continued,
    true,
  );
});
