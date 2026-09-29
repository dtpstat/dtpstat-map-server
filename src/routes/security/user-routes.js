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
    notificationEvents,
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

        notificationEvents
          ?.publish({
            level: 'info',
            message:
              'Ваши права или профиль администратора изменены. Интерфейс обновит активную сессию.',
            permission: 'any',
            audience: {
              userIds: [user.id],
            },
            control: {
              action:
                'refresh-session',
              reason:
                'admin-user-updated',
            },
            source: {
              kind:
                'security-user',
              id:
                String(user.id),
            },
          });

        if (
          Number(
            request.adminUser?.id,
          ) !==
          Number(user.id)
        ) {
          notificationEvents
            ?.publish({
              level: 'info',
              message:
                'Пользователь ' +
                user.username +
                ': изменения применены.',
              permission: 'users',
              audience: {
                userIds: [
                  request.adminUser.id,
                ],
              },
              source: {
                kind:
                  'security-user',
                id:
                  String(user.id),
              },
            });
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

        notificationEvents
          ?.publish({
            level: 'warn',
            message:
              'Учётная запись администратора удалена. Активная сессия будет завершена.',
            permission: 'any',
            audience: {
              userIds: [user.id],
            },
            control: {
              action: 'logout',
              reason:
                'admin-user-deleted',
            },
            source: {
              kind:
                'security-user',
              id:
                String(user.id),
            },
          });

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

  router.delete(
    '/admin/security/users/:userId/mfa',
    adminAuth.requireSuperuser,
    operationAudit(
      'security.user.mfa.reset',
    ),
    async (
      request,
      response,
      next,
    ) => {
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
            .resetUserMfa(
              userId,
              request.adminUser.id,
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

        notificationEvents
          ?.publish({
            level: 'warn',
            message:
              'MFA администратора сброшена. Активные сессии завершены.',
            permission: 'any',
            audience: {
              userIds: [
                result.userId,
              ],
            },
            control: {
              action: 'logout',
              reason:
                'admin-mfa-reset',
            },
            source: {
              kind:
                'security-user',
              id:
                String(
                  result.userId,
                ),
            },
          });

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

        notificationEvents
          ?.publish({
            level: 'warn',
            message:
              'Пароль администратора сброшен. Другие активные сессии завершены.',
            permission: 'any',
            audience: {
              userIds: [result.user.id],
            },
            control: {
              action: 'logout',
              reason:
                'temporary-password-reset',
            },
            source: {
              kind:
                'security-user',
              id:
                String(result.user.id),
            },
          });

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

        notificationEvents
          ?.publish({
            level: 'warn',
            message:
              'Учётная запись администратора заблокирована. Активная сессия будет завершена.',
            permission: 'any',
            audience: {
              userIds: [user.id],
            },
            control: {
              action: 'logout',
              reason:
                'admin-user-blocked',
            },
            source: {
              kind:
                'security-user',
              id:
                String(user.id),
            },
          });

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
