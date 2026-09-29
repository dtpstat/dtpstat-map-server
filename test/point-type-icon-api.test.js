import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import test from 'node:test';
import {
  createPointTypesRouter,
} from '../src/routes/point-types-api.js';

function pointTypeState() {
  return {
    id: 1,
    name: 'Остановка',
    isActive: true,
    displayWidth: 32,
    displayHeight: 32,
    anchorX: 16,
    anchorY: 16,
    iconConfigured: false,
    iconFileName: null,
    iconMime: null,
    iconSourceWidth: null,
    iconSourceHeight: null,
    iconSha256: null,
    geometryCount: 0,
  };
}

async function withServer(callback) {
  let pointType =
    pointTypeState();
  const files =
    new Map();

  const pointTypesRepository = {
    async list() {
      return [
        structuredClone(
          pointType,
        ),
      ];
    },

    async get(pointTypeId) {
      return Number(
        pointTypeId,
      ) === pointType.id
        ? structuredClone(
            pointType,
          )
        : null;
    },

    async saveIconMetadata(
      pointTypeId,
      icon,
    ) {
      if (
        Number(pointTypeId) !==
        pointType.id
      ) {
        return null;
      }

      const previousIconFileName =
        pointType.iconFileName;

      pointType = {
        ...pointType,
        iconConfigured: true,
        iconFileName:
          icon.fileName,
        iconMime:
          icon.mime,
        iconSourceWidth:
          icon.width,
        iconSourceHeight:
          icon.height,
        iconSha256:
          icon.sha256,
      };

      return {
        previousIconFileName,
        pointType:
          structuredClone(
            pointType,
          ),
      };
    },

    async clearIconMetadata(
      pointTypeId,
    ) {
      if (
        Number(pointTypeId) !==
        pointType.id
      ) {
        return null;
      }

      const previousIconFileName =
        pointType.iconFileName;

      pointType = {
        ...pointType,
        iconConfigured: false,
        iconFileName: null,
        iconMime: null,
        iconSourceWidth: null,
        iconSourceHeight: null,
        iconSha256: null,
      };

      return {
        previousIconFileName,
        pointType:
          structuredClone(
            pointType,
          ),
      };
    },

    async create() {
      throw new Error(
        'not used',
      );
    },

    async update() {
      throw new Error(
        'not used',
      );
    },

    async delete() {
      throw new Error(
        'not used',
      );
    },
  };

  const pointTypeIconStore = {
    async save(
      fileName,
      data,
    ) {
      files.set(
        fileName,
        Buffer.from(data),
      );
      return {
        fileName,
      };
    },

    async read(fileName) {
      const data =
        files.get(fileName);
      if (!data) {
        const error =
          new Error(
            'missing',
          );
        error.code =
          'ENOENT';
        throw error;
      }
      return Buffer.from(data);
    },

    async remove(fileName) {
      return files.delete(
        fileName,
      );
    },
  };

  const adminAuth = {
    requireInterface(
      request,
      _response,
      next,
    ) {
      request.adminUser = {
        id: 1,
        username: 'admin',
        canManageInterface: true,
      };
      next();
    },
  };

  const securityService = {
    async appendAudit() {},
  };

  const app =
    express();

  app.use(
    '/api',
    createPointTypesRouter({
      pointTypesRepository,
      pointTypeIconStore,
      adminAuth,
      securityService,
      maxBodyBytes:
        1024 * 1024,
    }),
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
      'http://127.0.0.1:' +
      address.port,
      {
        files,
      },
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
              ? reject(error)
              : resolve(),
        ),
    );
  }
}

test('point type icon API sanitizes stores versions serves and resets SVG', async () => {
  await withServer(
    async (
      baseUrl,
      state,
    ) => {
      const source =
        '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="24" viewBox="0 0 32 24">' +
        '<path style="fill:#123456;stroke:#000;stroke-width:1" d="M0 0 L32 0 L16 24 Z"/>' +
        '</svg>';

      const uploaded =
        await fetch(
          baseUrl +
          '/api/admin/point-types/1/icon',
          {
            method: 'PUT',
            headers: {
              'Content-Type':
                'image/svg+xml',
            },
            body: source,
          },
        );

      assert.equal(
        uploaded.status,
        200,
      );

      const payload =
        await uploaded.json();

      assert.equal(
        payload
          .pointType
          .iconConfigured,
        true,
      );
      assert.equal(
        payload
          .pointType
          .iconMime,
        'image/svg+xml',
      );
      assert.equal(
        payload
          .pointType
          .iconSourceWidth,
        32,
      );
      assert.equal(
        payload
          .pointType
          .iconSourceHeight,
        24,
      );
      assert.match(
        payload
          .pointType
          .iconUrl,
        /^\/api\/point-types\/1\/icon\?v=[0-9a-f]{64}$/u,
      );
      assert.equal(
        Object.hasOwn(
          payload.pointType,
          'iconFileName',
        ),
        false,
      );
      assert.equal(
        Object.hasOwn(
          payload.pointType,
          'iconSha256',
        ),
        false,
      );
      assert.equal(
        state.files.size,
        1,
      );

      const icon =
        await fetch(
          baseUrl +
          payload
            .pointType
            .iconUrl,
        );

      assert.equal(
        icon.status,
        200,
      );
      assert.match(
        icon.headers.get(
          'content-type',
        ) ?? '',
        /^image\/svg\+xml/u,
      );
      assert.equal(
        icon.headers.get(
          'x-content-type-options',
        ),
        'nosniff',
      );
      assert.match(
        icon.headers.get(
          'cache-control',
        ) ?? '',
        /immutable/u,
      );
      assert.match(
        icon.headers.get(
          'content-security-policy',
        ) ?? '',
        /default-src 'none'/u,
      );

      const served =
        await icon.text();

      assert.match(
        served,
        /style="fill:#123456;stroke:#000;stroke-width:1"/u,
      );
      assert.equal(
        served.includes(
          '<script',
        ),
        false,
      );

      const list =
        await fetch(
          baseUrl +
          '/api/point-types',
        );
      const listPayload =
        await list.json();

      assert.equal(
        listPayload
          .pointTypes[0]
          .iconUrl,
        payload
          .pointType
          .iconUrl,
      );

      const reset =
        await fetch(
          baseUrl +
          '/api/admin/point-types/1/icon',
          {
            method: 'DELETE',
          },
        );

      assert.equal(
        reset.status,
        200,
      );
      assert.equal(
        (
          await reset.json()
        )
          .pointType
          .iconConfigured,
        false,
      );
      assert.equal(
        state.files.size,
        0,
      );

      const missing =
        await fetch(
          baseUrl +
          '/api/point-types/1/icon',
        );
      assert.equal(
        missing.status,
        404,
      );
    },
  );
});

test('point type icon API rejects active SVG before file persistence', async () => {
  await withServer(
    async (
      baseUrl,
      state,
    ) => {
      const response =
        await fetch(
          baseUrl +
          '/api/admin/point-types/1/icon',
          {
            method: 'PUT',
            headers: {
              'Content-Type':
                'image/svg+xml',
            },
            body:
              '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">' +
              '<path style="fill:url(https://evil.example/a.svg)" d="M0 0L1 1"/>' +
              '</svg>',
          },
        );

      assert.equal(
        response.status,
        400,
      );
      assert.match(
        (
          await response.json()
        ).error,
        /unsafe CSS/u,
      );
      assert.equal(
        state.files.size,
        0,
      );
    },
  );
});
