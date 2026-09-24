import {
  createAdminOperationAudit,
} from '../../http/admin-operation-audit.js';

export function registerProjectSettingsTransferExportRoutes(
  router,
  {
    settingsTransferService,
    adminAuth,
    securityService,
  },
) {
  router.get(
    '/admin/settings/export',
    adminAuth.requireSuperuser,
    createAdminOperationAudit(
      securityService,
      'settings.export',
    ),
    async (
      _request,
      response,
      next,
    ) => {
      try {
        const payload =
          await settingsTransferService
            .exportSettings();

        response
          .set(
            'Cache-Control',
            'no-store',
          )
          .set(
            'Content-Disposition',
            'attachment; filename="project-settings.json"',
          )
          .type('application/json')
          .send(
            `${JSON.stringify(payload, null, 2)}\n`,
          );
      } catch (error) {
        next(error);
      }
    },
  );
}
