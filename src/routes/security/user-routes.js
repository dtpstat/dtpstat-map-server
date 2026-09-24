import {
  createAdminOperationAudit,
} from '../../http/admin-operation-audit.js';
import {
  handleAdminSecurityValidation,
  parsePositiveInteger,
} from './helpers.js';

export function registerAdminUserRoutes(
  router,
  {
    securityService,
    adminAuth,
    jsonBody,
  },
) {
  const operationAudit = (type) =>
    createAdminOperationAudit(
      securityService,
      type,
    );

  router.get(
    '/admin/security/users',
    adminAuth.requireUsers,
    async (
      _request,
      response,
      next,
    ) => {
      try {
        response
          .set(
            'Cache-Control',
            'no-store',
          )
          .json({
            users:
              await securityService
                .listUsers(),
          });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/admin/security/users',
    adminAuth.requireUsers,
    operationAudit(
      'security.user.create',
    ),
    jsonBody,
    async (request, response, next) => {
      try {
        const result =
          await securityService
            .createUser(
              request.body,
            );

        response
          .set(
            'Cache-Control',
            'no-store',
          )
          .status(201)
          .json(result);
      } catch (error) {
        if (
          handleAdminSecurityValidation(
            response,
            error,
          )
        ) {
          return;
        }

        next(error);
      }
    },
  );

  router.patch(
    '/admin/security/users/:userId',
    adminAuth.requireUsers,
    operationAudit(
      'security.user.update',
    ),
    jsonBody,
    async (request, response, next) => {
      const userId =
        parsePositiveInteger(
          request.params.userId,
        );

      if (!userId) {
        response
          .status(400)
          .json({
            error:
              'userId must be a positive integer',
          });
        return;
      }

      try {
        const user =
          await securityService
            .updateUser(
              userId,
              request.body,
            );

        if (!user) {
          response
            .status(404)
            .json({
              error:
                'Administrator user not found',
            });
          return;
        }

        response
          .set(
            'Cache-Control',
            'no-store',
          )
          .json({ user });
      } catch (error) {
        if (
          handleAdminSecurityValidation(
            response,
            error,
          )
        ) {
          return;
        }

        next(error);
      }
    },
  );

  router.delete(
    '/admin/security/users/:userId',
    adminAuth.requireUsers,
    operationAudit(
      'security.user.delete',
    ),
    async (request, response, next) => {
      const userId =
        parsePositiveInteger(
          request.params.userId,
        );

      if (!userId) {
        response
          .status(400)
          .json({
            error:
              'userId must be a positive integer',
          });
        return;
      }

      try {
        const user =
          await securityService
            .deleteUser(
              userId,
              request.adminUser.id,
            );

        if (!user) {
          response
            .status(404)
            .json({
              error:
                'Administrator user not found',
            });
          return;
        }

        response.json({ user });
      } catch (error) {
        if (
          handleAdminSecurityValidation(
            response,
            error,
          )
        ) {
          return;
        }

        next(error);
      }
    },
  );

  router.post(
    '/admin/security/users/:userId/temporary-password',
    adminAuth.requireUsers,
    operationAudit(
      'security.user.temporary-password',
    ),
    async (request, response, next) => {
      const userId =
        parsePositiveInteger(
          request.params.userId,
        );

      if (!userId) {
        response
          .status(400)
          .json({
            error:
              'userId must be a positive integer',
          });
        return;
      }

      try {
        const result =
          await securityService
            .resetTemporaryPassword(
              userId,
            );

        if (!result) {
          response
            .status(404)
            .json({
              error:
                'Administrator user not found',
            });
          return;
        }

        response
          .set(
            'Cache-Control',
            'no-store',
          )
          .json(result);
      } catch (error) {
        if (
          handleAdminSecurityValidation(
            response,
            error,
          )
        ) {
          return;
        }

        next(error);
      }
    },
  );

  router.post(
    '/admin/security/users/:userId/block',
    adminAuth.requireUsers,
    operationAudit(
      'security.user.block',
    ),
    jsonBody,
    async (request, response, next) => {
      const userId =
        parsePositiveInteger(
          request.params.userId,
        );

      if (!userId) {
        response
          .status(400)
          .json({
            error:
              'userId must be a positive integer',
          });
        return;
      }

      try {
        const user =
          await securityService
            .blockUser(
              userId,
              request.body,
              request.adminUser,
            );

        if (!user) {
          response
            .status(404)
            .json({
              error:
                'Administrator user not found',
            });
          return;
        }

        response.json({ user });
      } catch (error) {
        if (
          handleAdminSecurityValidation(
            response,
            error,
          )
        ) {
          return;
        }

        next(error);
      }
    },
  );

  router.post(
    '/admin/security/users/:userId/unblock',
    adminAuth.requireUsers,
    operationAudit(
      'security.user.unblock',
    ),
    async (request, response, next) => {
      const userId =
        parsePositiveInteger(
          request.params.userId,
        );

      if (!userId) {
        response
          .status(400)
          .json({
            error:
              'userId must be a positive integer',
          });
        return;
      }

      try {
        const user =
          await securityService
            .unblockUser(userId);

        if (!user) {
          response
            .status(404)
            .json({
              error:
                'Administrator user not found',
            });
          return;
        }

        response.json({ user });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    '/admin/security/users/:userId/avatar',
    adminAuth.requireUsersOrAudit,
    async (request, response, next) => {
      const userId =
        parsePositiveInteger(
          request.params.userId,
        );

      if (!userId) {
        response
          .status(400)
          .json({
            error:
              'userId must be a positive integer',
          });
        return;
      }

      try {
        const avatar =
          await securityService
            .getAvatar(userId);

        if (!avatar?.data) {
          response.status(404).end();
          return;
        }

        response
          .set(
            'Cache-Control',
            'private, max-age=60',
          )
          .type(avatar.mime)
          .send(avatar.data);
      } catch (error) {
        next(error);
      }
    },
  );
}
