import {
  ProjectSettingsValidationError,
} from '../../data/project-settings.js';
import {
  createAdminOperationAudit,
  recordAdminOperationChanges,
} from '../../http/admin-operation-audit.js';

export function registerProjectDownloadNameRoutes(
  router,
  {
    projectSettingsRepository,
    adminAuth,
    securityService,
    jsonBody,
    afterPublicDownloadNameSave,
  },
) {
  if (
    typeof projectSettingsRepository
      .savePublicDownloadName !==
    'function'
  ) {
    return;
  }

  router.put(
    '/admin/project-settings/public-download-name',
    adminAuth.requireInterface,
    createAdminOperationAudit(
      securityService,
      'interface.project.public-download-name.update',
    ),
    jsonBody,
    async (request, response, next) => {
      let previousName;

      try {
        previousName =
          (
            await projectSettingsRepository
              .get()
          ).publicDownloadName;

        const settings =
          await projectSettingsRepository
            .savePublicDownloadName(
              request.body
                ?.publicDownloadName,
            );

        const publicDownloads =
          await afterPublicDownloadNameSave?.();

        recordAdminOperationChanges(
          response,
          {
            publicDownloadName:
              previousName,
          },
          {
            publicDownloadName:
              settings
                .publicDownloadName,
          },
        );

        response
          .set(
            'Cache-Control',
            'no-store',
          )
          .json({
            settings,
            publicDownloads,
          });
      } catch (error) {
        if (
          error instanceof
          ProjectSettingsValidationError
        ) {
          response
            .status(400)
            .json({
              error: error.message,
            });
          return;
        }

        if (
          previousName !== undefined &&
          typeof afterPublicDownloadNameSave ===
            'function'
        ) {
          try {
            await projectSettingsRepository
              .savePublicDownloadName(
                previousName,
              );

            await afterPublicDownloadNameSave();
          } catch {
            // Preserve the original failure. Startup refresh will repair any
            // filesystem/DB mismatch if rollback materialization also fails.
          }
        }

        next(error);
      }
    },
  );
}
