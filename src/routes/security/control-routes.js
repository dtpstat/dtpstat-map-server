import {
  requestClientIp,
} from '../../shared/http/client-ip.js';
import {
  createAdminOperationAudit,
} from '../../http/admin-operation-audit.js';
import {
  handleAdminSecurityValidation,
  parsePositiveInteger,
} from './helpers.js';

export function registerAdminSecurityControlRoutes(
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
    '/admin/security/settings',
    adminAuth.requireSecurity,
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
            settings:
              await securityService
                .getSecuritySettings(),
          });
      } catch (error) {
        next(error);
      }
    },
  );

  router.put(
    '/admin/security/settings',
    adminAuth.requireSecurity,
    operationAudit(
      'security.settings.update',
    ),
    jsonBody,
    async (request, response, next) => {
      try {
        response.json({
          settings:
            await securityService
              .saveSecuritySettings(
                request.body,
              ),
        });
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
    '/admin/security/metrics-token',
    adminAuth.requireSecurity,
    operationAudit(
      'security.metrics-token.rotate',
    ),
    async (
      _request,
      response,
      next,
    ) => {
      try {
        response.json(
          await securityService
            .rotateMetricsToken(),
        );
      } catch (error) {
        next(error);
      }
    },
  );

  router.delete(
    '/admin/security/metrics-token',
    adminAuth.requireSecurity,
    operationAudit(
      'security.metrics-token.clear',
    ),
    async (
      _request,
      response,
      next,
    ) => {
      try {
        response.json({
          settings:
            await securityService
              .clearMetricsToken(),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    '/admin/security/ip-allowlist',
    adminAuth.requireSecurity,
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
            entries:
              await securityService
                .listIpAllowlist(),
          });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/admin/security/ip-allowlist',
    adminAuth.requireSecurity,
    operationAudit(
      'security.ip.allowlist.add',
    ),
    jsonBody,
    async (
      request,
      response,
      next,
    ) => {
      try {
        const entry =
          await securityService
            .createIpAllowlistEntry(
              request.body,
              request.adminUser,
            );

        response
          .status(201)
          .json({ entry });
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
    '/admin/security/ip-allowlist/:entryId',
    adminAuth.requireSecurity,
    operationAudit(
      'security.ip.allowlist.delete',
    ),
    async (
      request,
      response,
      next,
    ) => {
      const entryId =
        parsePositiveInteger(
          request.params.entryId,
        );

      if (!entryId) {
        response
          .status(400)
          .json({
            error:
              'entryId must be a positive integer',
          });
        return;
      }

      try {
        if (
          !await securityService
            .deleteIpAllowlistEntry(
              entryId,
            )
        ) {
          response
            .status(404)
            .json({
              error:
                'IP allowlist entry not found',
            });
          return;
        }

        response.json({
          deleted: true,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    '/admin/security/ip-blocks',
    adminAuth.requireSecurity,
    async (
      _request,
      response,
      next,
    ) => {
      try {
        response.json({
          blocks:
            await securityService
              .listIpBlocks(),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/admin/security/ip-blocks',
    adminAuth.requireSecurity,
    operationAudit(
      'security.ip.block',
    ),
    jsonBody,
    async (request, response, next) => {
      try {
        const block =
          await securityService
            .createIpBlock(
              request.body,
              request.adminUser,
              requestClientIp(request),
            );

        response
          .status(201)
          .json({ block });
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
    '/admin/security/ip-blocks/:blockId',
    adminAuth.requireSecurity,
    operationAudit(
      'security.ip.unblock',
    ),
    async (request, response, next) => {
      const blockId =
        parsePositiveInteger(
          request.params.blockId,
        );

      if (!blockId) {
        response
          .status(400)
          .json({
            error:
              'blockId must be a positive integer',
          });
        return;
      }

      try {
        if (
          !await securityService
            .deleteIpBlock(blockId)
        ) {
          response
            .status(404)
            .json({
              error:
                'IP block not found',
            });
          return;
        }

        response.json({
          deleted: true,
        });
      } catch (error) {
        next(error);
      }
    },
  );
}
