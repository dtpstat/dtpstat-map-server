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
  const rateSettingsCacheMs =
    dependencies.rateSettingsCacheMs ??
    5_000;
  let cachedRateSettings =
    null;
  let cachedRateSettingsUntil =
    0;
  let rateSettingsPromise =
    null;

  const loadRateSettings =
    async () => {
      const now =
        Date.now();

      if (
        cachedRateSettings &&
        now <
          cachedRateSettingsUntil
      ) {
        return cachedRateSettings;
      }

      if (!rateSettingsPromise) {
        rateSettingsPromise =
          Promise.resolve(
            securityService
              .getSecuritySettings(),
          )
            .then(
              (settings) => {
                cachedRateSettings =
                  settings ?? {};
                cachedRateSettingsUntil =
                  Date.now() +
                  rateSettingsCacheMs;
                return cachedRateSettings;
              },
            )
            .catch(
              (error) => {
                console.error(
                  'Admin request rate settings refresh failed',
                  error,
                );
                return (
                  cachedRateSettings ??
                  {}
                );
              },
            )
            .finally(
              () => {
                rateSettingsPromise =
                  null;
              },
            );
      }

      return rateSettingsPromise;
    };

  const recordRateLimit =
    (
      request,
      result,
      rateLimit,
    ) => {
      if (
        rateLimit.shouldLog ===
        false
      ) {
        return;
      }

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
          String(
            request.originalUrl ??
            request.path ??
            request.url ??
            '',
          ).split('?')[0],
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

  const enforceUserRequestRate =
    (
      request,
      response,
      result,
    ) => {
      const rateLimit =
        requestRateLimiter
          .consumeUser({
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

  const limitGlobalRequest =
    async (
      request,
      response,
      next,
    ) => {
      try {
        const settings =
          await loadRateSettings();
        const rateLimit =
          requestRateLimiter
            .consumeGlobal({
              settings,
            });

        if (
          rateLimit.allowed
        ) {
          next();
          return;
        }

        if (
          rateLimit.shouldLog !==
          false
        ) {
          const ipAddress =
            requestClientIp(
              request,
            );
          const details = {
            scope: 'global',
            limit:
              rateLimit.limit,
            retryAfterSeconds:
              rateLimit
                .retryAfterSeconds,
            method:
              request.method,
            path:
              String(
                request.originalUrl ??
                request.path ??
                request.url ??
                '',
              ).split('?')[0],
          };

          securityLog(
            'admin.request.rate_limited',
            {
              ...details,
              ip:
                ipAddress,
              userId: null,
              username: null,
            },
          );

          if (
            typeof securityService
              .appendAudit ===
            'function'
          ) {
            await securityService
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
                userId: null,
                username: null,
                details,
              });
          }
        }

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
      } catch (error) {
        next(error);
      }
    };

  const authenticateRequest =
    async (request) =>
      securityService.authenticateRequest({
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
              {},
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
            await rejectAdminTransportTampering(
              request,
              response,
            )
          ) {
            return;
          }

          if (
            !enforceUserRequestRate(
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
          await rejectAdminTransportTampering(
            request,
            response,
          )
        ) {
          return;
        }

        if (
          !enforceUserRequestRate(
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

    limitGlobalRequest,

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
