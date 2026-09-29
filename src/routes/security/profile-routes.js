import {
  requestClientIp,
} from '../../shared/http/client-ip.js';
import {
  adminSessionCookie,
  adminSessionToken,
  clearAdminSessionCookie,
} from '../../http/admin-session-http.js';
import {
  createAdminOperationAudit,
} from '../../http/admin-operation-audit.js';
import {
  handleAdminSecurityValidation,
  parsePositiveInteger,
} from './helpers.js';

export function registerAdminProfileRoutes(
  router,
  {
    securityService,
    adminAuth,
    jsonBody,
    avatarBody,
    notificationEvents,
    sessionCookieSecureOnly = false,
  },
) {
  const sessionCookieOptions =
    (request) => ({
      secureOnly:
        sessionCookieSecureOnly ===
        true,
      secure:
        request.secure === true,
    });

  const sendLoginSession =
    (
      request,
      response,
      result,
    ) => {
      const maxAge =
        Math.max(
          1,
          Math.floor(
            (
              new Date(
                result.expiresAt,
              ).valueOf() -
              Date.now()
            ) /
            1000,
          ),
        );

      response
        .set(
          'Cache-Control',
          'no-store',
        )
        .set(
          'Set-Cookie',
          adminSessionCookie(
            result.token,
            maxAge,
            sessionCookieOptions(
              request,
            ),
          ),
        )
        .json({
          user:
            result.user,
        });
    };

  const operationAudit = (type) =>
    createAdminOperationAudit(
      securityService,
      type,
    );

  router.post(
    '/admin/login',
    jsonBody,
    async (request, response, next) => {
      try {
        const result =
          await securityService.login(
            request.body,
            {
              ipAddress:
                requestClientIp(request),
              userAgent:
                request.get('user-agent'),
            },
          );

        if (
          result.status ===
          'ip-blocked'
        ) {
          response
            .status(403)
            .json({
              error:
                'This IP address is blocked',
            });
          return;
        }

        if (
          result.status ===
          'ip-locked'
        ) {
          response.set(
            'Retry-After',
            String(
              result.retryAfterSeconds ??
              1,
            ),
          );
          response
            .status(429)
            .json({
              error:
                'Too many failed login attempts from this IP address',
              retryAfterSeconds:
                result.retryAfterSeconds,
            });
          return;
        }

        if (
          result.status ===
          'blocked'
        ) {
          response
            .status(403)
            .json({
              error:
                'Administrator account is blocked',
            });
          return;
        }

        if (
          result.status ===
          'locked'
        ) {
          response.set(
            'Retry-After',
            String(
              result.retryAfterSeconds ??
              1,
            ),
          );
          response
            .status(423)
            .json({
              error:
                'Administrator account is temporarily locked',
              retryAfterSeconds:
                result.retryAfterSeconds,
            });
          return;
        }

        if (
          result.status ===
          'mfa-unavailable'
        ) {
          response
            .status(503)
            .json({
              error:
                'Multi-factor authentication is temporarily unavailable',
            });
          return;
        }

        if (
          result.status ===
          'mfa-required'
        ) {
          response
            .status(202)
            .set(
              'Cache-Control',
              'no-store',
            )
            .json({
              mfaRequired:
                true,
              challengeToken:
                result
                  .challengeToken,
              expiresAt:
                result.expiresAt,
            });
          return;
        }

        if (
          result.status !==
          'success'
        ) {
          response
            .status(401)
            .json({
              error:
                'Invalid username or password',
            });
          return;
        }

        sendLoginSession(
          request,
          response,
          result,
        );
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
    '/admin/login/mfa',
    jsonBody,
    async (
      request,
      response,
      next,
    ) => {
      try {
        const result =
          await securityService
            .completeMfaLogin(
              request.body,
              {
                ipAddress:
                  requestClientIp(
                    request,
                  ),
                userAgent:
                  request.get(
                    'user-agent',
                  ),
              },
            );

        if (
          result.status ===
          'mfa-unavailable'
        ) {
          response
            .status(503)
            .json({
              error:
                'Multi-factor authentication is temporarily unavailable',
            });
          return;
        }

        if (
          result.status ===
          'ip-locked'
        ) {
          response
            .set(
              'Retry-After',
              String(
                result
                  .retryAfterSeconds ??
                1,
              ),
            )
            .status(429)
            .json({
              error:
                'Too many failed login attempts from this IP address',
              retryAfterSeconds:
                result
                  .retryAfterSeconds,
            });
          return;
        }

        if (
          result.status ===
          'locked'
        ) {
          response
            .set(
              'Retry-After',
              String(
                result
                  .retryAfterSeconds ??
                1,
              ),
            )
            .status(423)
            .json({
              error:
                'Administrator account is temporarily locked',
              retryAfterSeconds:
                result
                  .retryAfterSeconds,
            });
          return;
        }

        if (
          result.status !==
          'success'
        ) {
          response
            .status(401)
            .json({
              error:
                result.status ===
                'invalid-mfa'
                  ? 'Invalid verification code'
                  : 'MFA challenge expired or invalid',
            });
          return;
        }

        sendLoginSession(
          request,
          response,
          result,
        );
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
    '/admin/logout',
    adminAuth.requireProfile,
    async (request, response, next) => {
      try {
        await securityService.logout(
          adminSessionToken(
            request,
            sessionCookieOptions(
              request,
            ),
          ),
        );

        response
          .set(
            'Cache-Control',
            'no-store',
          )
          .set(
            'Set-Cookie',
            clearAdminSessionCookie(
              sessionCookieOptions(
                request,
              ),
            ),
          )
          .status(204)
          .end();
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    '/admin/me',
    adminAuth.requireProfile,
    (request, response) => {
      response.set(
        'Cache-Control',
        'no-store',
      );

      response.json({
        user: request.adminUser,
        sessionId:
          request.adminSessionId,
        expiresAt:
          request
            .adminSessionExpiresAt ??
          null,
      });
    },
  );

  router.patch(
    '/admin/profile',
    adminAuth.requireProfile,
    operationAudit(
      'profile.update',
    ),
    jsonBody,
    async (request, response, next) => {
      try {
        const user =
          await securityService
            .updateOwnProfile(
              request.adminUser.id,
              request.body,
            );

        notificationEvents
          ?.publish({
            level: 'info',
            message:
              'Профиль администратора обновлён в другой активной сессии.',
            permission: 'any',
            audience: {
              userIds: [
                request.adminUser.id,
              ],
              excludeSessionIds: [
                request.adminSessionId,
              ],
            },
            control: {
              action:
                'refresh-session',
              reason:
                'profile-updated',
            },
            source: {
              kind:
                'admin-profile',
              id:
                String(
                  request.adminUser.id,
                ),
            },
          });

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

  router.get(
    '/admin/profile/password-policy',
    adminAuth.requireProfile,
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
            policy:
              await securityService
                .getPasswordPolicy(),
          });
      } catch (error) {
        next(error);
      }
    },
  );

  router.put(
    '/admin/profile/password',
    adminAuth.requireProfile,
    operationAudit(
      'profile.password.change',
    ),
    jsonBody,
    async (request, response, next) => {
      try {
        const user =
          await securityService
            .changeOwnPassword(
              request.adminUser.id,
              request.body,
              request.adminSessionId,
            );

        notificationEvents
          ?.publish({
            level: 'warn',
            message:
              'Пароль изменён. Другие активные сессии администратора завершены.',
            permission: 'any',
            audience: {
              userIds: [
                request.adminUser.id,
              ],
              excludeSessionIds: [
                request.adminSessionId,
              ],
            },
            control: {
              action: 'logout',
              reason:
                'password-changed',
            },
            source: {
              kind:
                'admin-profile',
              id:
                String(
                  request.adminUser.id,
                ),
            },
          });

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

  router.get(
    '/admin/profile/avatar',
    adminAuth.requireProfile,
    async (request, response, next) => {
      try {
        const avatar =
          await securityService.getAvatar(
            request.adminUser.id,
          );

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

  router.put(
    '/admin/profile/avatar',
    adminAuth.requireProfile,
    operationAudit(
      'profile.avatar.update',
    ),
    avatarBody,
    async (request, response, next) => {
      try {
        const user =
          await securityService.saveAvatar(
            request.adminUser.id,
            request
              .get('content-type')
              ?.split(';')[0]
              ?.trim(),
            request.body,
          );

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
    '/admin/profile/avatar',
    adminAuth.requireProfile,
    operationAudit(
      'profile.avatar.delete',
    ),
    async (request, response, next) => {
      try {
        const user =
          await securityService
            .clearAvatar(
              request.adminUser.id,
            );

        response
          .set(
            'Cache-Control',
            'no-store',
          )
          .json({ user });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    '/admin/profile/sessions',
    adminAuth.requireProfile,
    async (request, response, next) => {
      try {
        response
          .set(
            'Cache-Control',
            'no-store',
          )
          .json({
            currentSessionId:
              request.adminSessionId,
            sessions:
              await securityService
                .listUserSessions(
                  request.adminUser.id,
                ),
          });
      } catch (error) {
        next(error);
      }
    },
  );

  router.delete(
    '/admin/profile/sessions/others',
    adminAuth.requireProfile,
    async (request, response, next) => {
      try {
        const revoked =
          await securityService
            .revokeOtherSessions(
              request.adminUser.id,
              request.adminSessionId,
            );

        notificationEvents
          ?.publish({
            level: 'warn',
            message:
              'Эта административная сессия была отозвана.',
            permission: 'any',
            audience: {
              userIds: [
                request.adminUser.id,
              ],
              excludeSessionIds: [
                request.adminSessionId,
              ],
            },
            control: {
              action: 'logout',
              reason:
                'other-sessions-revoked',
            },
            source: {
              kind:
                'admin-session',
              id:
                String(
                  request.adminUser.id,
                ),
            },
          });

        response.json({ revoked });
      } catch (error) {
        next(error);
      }
    },
  );

  router.delete(
    '/admin/profile/sessions/:sessionId',
    adminAuth.requireProfile,
    async (request, response, next) => {
      const sessionId =
        parsePositiveInteger(
          request.params.sessionId,
        );

      if (!sessionId) {
        response
          .status(400)
          .json({
            error:
              'sessionId must be a positive integer',
          });
        return;
      }

      try {
        const revoked =
          await securityService
            .revokeSession(
              request.adminUser.id,
              sessionId,
            );

        if (!revoked) {
          response
            .status(404)
            .json({
              error:
                'Session not found',
            });
          return;
        }

        const deletingCurrent =
          request.adminSessionId ===
          sessionId;

        notificationEvents
          ?.publish({
            level: 'warn',
            message:
              'Эта административная сессия была отозвана.',
            permission: 'any',
            audience: {
              sessionIds: [
                sessionId,
              ],
            },
            control: {
              action: 'logout',
              reason:
                'session-revoked',
            },
            source: {
              kind:
                'admin-session',
              id:
                String(sessionId),
            },
          });

        if (deletingCurrent) {
          response.set(
            'Set-Cookie',
            clearAdminSessionCookie(
              sessionCookieOptions(
                request,
              ),
            ),
          );
        }

        response.json({
          revoked: true,
          loggedOut: deletingCurrent,
        });
      } catch (error) {
        next(error);
      }
    },
  );
}
