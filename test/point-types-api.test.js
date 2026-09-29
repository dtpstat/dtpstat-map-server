import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import test from 'node:test';
import {
  createPointTypesRouter,
} from '../src/routes/point-types-api.js';

async function withServer(callback) {
  let rows = [];
  let nextId = 1;

  const pointTypesRepository = {
    async list() {
      return structuredClone(rows);
    },

    async create(payload) {
      const pointType = {
        id: nextId,
        name: payload.name,
        isActive:
          payload.isActive ??
          true,
        displayWidth:
          payload.displayWidth ??
          32,
        displayHeight:
          payload.displayHeight ??
          32,
        anchorX:
          payload.anchorX ??
          16,
        anchorY:
          payload.anchorY ??
          16,
        iconConfigured: false,
        geometryCount: 0,
      };
      nextId += 1;
      rows.push(pointType);
      return structuredClone(
        pointType,
      );
    },

    async update(
      pointTypeId,
      payload,
    ) {
      const id =
        Number(pointTypeId);
      const index =
        rows.findIndex(
          (item) =>
            item.id === id,
        );
      if (index < 0) {
        return null;
      }
      rows[index] = {
        ...rows[index],
        ...payload,
      };
      return structuredClone(
        rows[index],
      );
    },

    async delete(pointTypeId) {
      const id =
        Number(pointTypeId);
      const index =
        rows.findIndex(
          (item) =>
            item.id === id,
        );
      if (index < 0) {
        return null;
      }
      const [deleted] =
        rows.splice(
          index,
          1,
        );
      return {
        ...deleted,
        iconFileName: null,
        unlinkedGeometryCount: 2,
      };
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

  const app = express();
  app.use(
    '/api',
    createPointTypesRouter({
      pointTypesRepository,
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
      `http://127.0.0.1:${address.port}`,
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

test('point type API lists creates updates and deletes types', async () => {
  await withServer(
    async (baseUrl) => {
      const empty =
        await fetch(
          `${baseUrl}/api/point-types`,
        );
      assert.equal(
        empty.status,
        200,
      );
      assert.deepEqual(
        (await empty.json())
          .pointTypes,
        [],
      );

      const created =
        await fetch(
          `${baseUrl}/api/admin/point-types`,
          {
            method: 'POST',
            headers: {
              'Content-Type':
                'application/json',
            },
            body:
              JSON.stringify({
                name:
                  'Остановка',
              }),
          },
        );
      assert.equal(
        created.status,
        201,
      );
      const createdPayload =
        await created.json();
      assert.equal(
        createdPayload
          .pointType
          .displayWidth,
        32,
      );

      const updated =
        await fetch(
          `${baseUrl}/api/admin/point-types/1`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type':
                'application/json',
            },
            body:
              JSON.stringify({
                isActive: false,
                displayWidth: 48,
                anchorX: 24,
              }),
          },
        );
      assert.equal(
        updated.status,
        200,
      );
      assert.equal(
        (await updated.json())
          .pointType
          .isActive,
        false,
      );

      const deleted =
        await fetch(
          `${baseUrl}/api/admin/point-types/1`,
          {
            method: 'DELETE',
          },
        );
      assert.equal(
        deleted.status,
        200,
      );
      const deletedPayload =
        await deleted.json();
      assert.equal(
        deletedPayload
          .unlinkedGeometryCount,
        2,
      );
    },
  );
});

test('point type API returns not found for missing mutations', async () => {
  await withServer(
    async (baseUrl) => {
      const update =
        await fetch(
          `${baseUrl}/api/admin/point-types/999`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type':
                'application/json',
            },
            body:
              JSON.stringify({
                name: 'Нет',
              }),
          },
        );
      assert.equal(
        update.status,
        404,
      );

      const remove =
        await fetch(
          `${baseUrl}/api/admin/point-types/999`,
          {
            method: 'DELETE',
          },
        );
      assert.equal(
        remove.status,
        404,
      );
    },
  );
});
