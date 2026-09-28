import {
  adminHasPermission,
} from '../modules/security/authorization-policy.js';
import {
  createAdminRequestRateLimiter,
} from './admin-request-rate-limit.js';
import {
  installAdminRequestSecurityContext,
  rejectAdminTransportTampering,
} from './admin-request-security.js';
import {
  securityLog,
} from '../service-log.js';
import {
  requestClientIp,
} from '../shared/http/client-ip.js';
import {
  sendAdminAuthorizationError,
  respondAdminAuthenticationFailure,
} from './admin-auth-response.js';
import {
  adminCsrfAllowed,
} from './admin-csrf.js';
import {
  adminSessionToken,
  applyAdminSessionContext,
} from './admin-session-http.js';

export {
  createAdminOperationAudit,
  recordAdminOperationChanges,
  recordAdminOperationDetails,
} from './admin-operation-audit.js';

/**
 * Session cookies are preferred for the interactive web admin. DB-backed Basic
 * Auth remains accepted for scripts and compatibility clients.
 */
export function createAdminAuthorization(
  securityService,
  dependencies = {},
) {
  const requestRateLimiter =
    dependencies.requestRateLimiter ??
    createAdminRequestRateLimiter();

  const recordRateLimit =
    (
      request,
      result,
      rateLimit,
    ) => {
      const ipAddress =
        requestClientIp(request);
      const details = {
        scope:
          rateLimit.scope,
        limit:
          rateLimit.limit,
        retryAfterSeconds:
          rateLimit
            .retryAfterSeconds,
        method:
          request.method,
        path:
          request.path,
      };

      securityLog(
        'admin.request.rate_limited',
        {
          ...details,
          ip:
            ipAddress,
          userId:
            result.user?.id ??
            null,
          username:
            result.user?.username ??
            null,
        },
      );

      if (
        typeof securityService
          .appendAudit ===
        'function'
      ) {
        void Promise.resolve(
          securityService
            .appendAudit({
              eventType:
                'security',
              operationType:
                'admin.request.rate-limit',
              status:
                'blocked',
              durationMs:
                null,
              ipAddress,
              userId:
                result.user?.id ??
                null,
              username:
                result.user?.username ??
                null,
              details,
            }),
        ).catch(
          (error) =>
            console.error(
              'Admin rate-limit audit write failed',
              error,
            ),
        );
      }
    };

  const enforceRequestRate =
    (
      request,
      response,
      result,
    ) => {
      const rateLimit =
        requestRateLimiter
          .consume({
            userId:
              result.user.id,
            settings:
              result
                .securitySettings ??
              {},
          });

      if (
        rateLimit.allowed
      ) {
        return true;
      }

      recordRateLimit(
        request,
        result,
        rateLimit,
      );

      sendAdminAuthorizationError(
        response,
        429,
        'Administrative request rate limit exceeded',
        {
          code:
            'admin_request_rate_limited',
          retryAfterSeconds:
            rateLimit
              .retryAfterSeconds,
        },
      );

      return false;
    };

  const authenticateRequest =
    async (request) =>
      securityService.authenticateRequest({
        authorization:
          request.get?.(
            'authorization',
          ) ??
          request.headers
            ?.authorization,
        sessionToken:
          adminSessionToken(request),
        ipAddress:
          requestClientIp(request),
        userAgent:
          request.get?.(
            'user-agent',
          ) ??
          request.headers?.[
            'user-agent'
          ],
      });

  const middleware =
    (
      permission = 'any',
      options = {},
    ) =>
      async (
        request,
        response,
        next,
      ) => {
        try {
          const result =
            await authenticateRequest(
              request,
            );

          if (
            respondAdminAuthenticationFailure(
              response,
              result,
              {
                challengeOnMissing:
                  Boolean(
                    request.get?.(
                      'authorization',
                    ),
                  ),
              },
            )
          ) {
            return;
          }

          installAdminRequestSecurityContext(
            request,
            response,
            {
              securityService,
              user:
                result.user,
            },
          );

          if (
            rejectAdminTransportTampering(
              request,
              response,
            )
          ) {
            return;
          }

          if (
            !enforceRequestRate(
              request,
              response,
              result,
            )
          ) {
            request
              .adminSecurityIncidentRecorded =
              true;
            return;
          }

          if (
            !adminCsrfAllowed(
              request,
              result.authMethod,
            )
          ) {
            sendAdminAuthorizationError(
              response,
              403,
              'Cross-site administrative request rejected',
            );
            return;
          }

          const user =
            result.user;

          if (
            user.mustChangePassword &&
            !options
              .allowPasswordChangePending
          ) {
            sendAdminAuthorizationError(
              response,
              428,
              'Password change required',
              {
                code:
                  'password_change_required',
              },
            );
            return;
          }

          if (
            !adminHasPermission(
              user,
              permission,
            )
          ) {
            sendAdminAuthorizationError(
              response,
              403,
              'Administrator permission is required',
            );
            return;
          }

          applyAdminSessionContext(
            request,
            response,
            result,
          );

          next();
        } catch (error) {
          next(error);
        }
      };

  const requireAdminEntry =
    async (
      request,
      response,
      next,
    ) => {
      try {
        const result =
          await authenticateRequest(
            request,
          );

        if (
          result.status !==
          'success'
        ) {
          response.redirect(
            302,
            '/admin/login.html',
          );
          return;
        }

        installAdminRequestSecurityContext(
          request,
          response,
          {
            securityService,
            user:
              result.user,
          },
        );

        if (
          rejectAdminTransportTampering(
            request,
            response,
          )
        ) {
          return;
        }

        if (
          !enforceRequestRate(
            request,
            response,
            result,
          )
        ) {
          request
            .adminSecurityIncidentRecorded =
            true;
          return;
        }

        applyAdminSessionContext(
          request,
          response,
          result,
        );

        next();
      } catch (error) {
        next(error);
      }
    };

  return {
    requireAny:
      middleware('any'),

    requireAdminEntry,

    requireProfile:
      middleware(
        'profile',
        {
          allowPasswordChangePending:
            true,
        },
      ),

    requireData:
      middleware('data'),

    requireInterface:
      middleware('interface'),

    requireOsmEditor:
      middleware('osm-editor'),

    requireGeometryEditor:
      middleware('geometry-editor'),

    requireUsers:
      middleware('users'),

    requireAudit:
      middleware('audit'),

    requireUsersOrAudit:
      middleware(
        'users-or-audit',
      ),

    requireSecurity:
      middleware('security'),

    requireSuperuser:
      middleware('superuser'),

    async authenticateUpgrade(
      request,
      permission = 'data',
    ) {
      const result =
        await securityService
          .authenticateRequest({
            authorization:
              request.headers
                .authorization,
            sessionToken:
              adminSessionToken(
                request,
              ),
            ipAddress:
              requestClientIp(
                request,
              ),
            userAgent:
              request.headers[
                'user-agent'
              ],
          });

      if (
        result.status !==
        'success'
      ) {
        return result;
      }

      if (
        result.user
          .mustChangePassword
      ) {
        return {
          status:
            'password-change-required',
          user: result.user,
        };
      }

      return adminHasPermission(
        result.user,
        permission,
      )
        ? result
        : {
          status: 'forbidden',
          user: result.user,
        };
    },
  };
}
