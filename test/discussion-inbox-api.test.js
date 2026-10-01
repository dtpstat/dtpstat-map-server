import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import test from 'node:test';
import {
  createDiscussionInboxRouter,
} from '../src/routes/discussion-inbox-api.js';

const cookie =
  'dtpstat_admin_session=test-session-token';

async function withServer(
  callback,
) {
  const calls = [];
  const app = express();

  const adminAuth = {
    requireProfile(
      request,
      response,
      next,
    ) {
      if (
        request.get('cookie') !==
        cookie
      ) {
        response
          .status(401)
          .json({
            error:
              'Authentication required',
          });
        return;
      }

      request.adminUser = {
        id: 7,
        username:
          'editor',
        canEditGeometries:
          true,
      };
      next();
    },
  };

  const discussionInboxService = {
    async listInbox(user) {
      calls.push(user);
      return {
        items: [{
          subjectType:
            'geometry',
          subjectId: 10,
          unreadCount: 2,
        }],
        totalUnread: 2,
      };
    },
  };

  app.use(
    '/api',
    createDiscussionInboxRouter({
      discussionInboxService,
      adminAuth,
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
      calls,
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

test('profile discussion inbox requires profile auth and returns no-store read model', async () => {
  await withServer(
    async (
      baseUrl,
      calls,
    ) => {
      const denied =
        await fetch(
          baseUrl +
            '/api/admin/profile/discussions',
        );

      assert.equal(
        denied.status,
        401,
      );

      const response =
        await fetch(
          baseUrl +
            '/api/admin/profile/discussions',
          {
            headers: {
              Cookie:
                cookie,
            },
          },
        );

      assert.equal(
        response.status,
        200,
      );
      assert.equal(
        response.headers.get(
          'cache-control',
        ),
        'no-store',
      );
      assert.deepEqual(
        await response.json(),
        {
          items: [{
            subjectType:
              'geometry',
            subjectId: 10,
            unreadCount: 2,
          }],
          totalUnread: 2,
        },
      );
      assert.equal(
        calls.length,
        1,
      );
      assert.equal(
        calls[0].id,
        7,
      );
    },
  );
});
