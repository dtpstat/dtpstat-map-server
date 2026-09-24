import express from 'express';
import {
  isProjectSettingsTransferInputValidationError,
} from '../../application/data-transfer/project-settings-service.js';
import {
  createAdminOperationAudit,
  recordAdminOperationChanges,
  recordAdminOperationDetails,
} from '../../http/admin-operation-audit.js';

function errorMessage(error) {
  return error instanceof Error
    ? error.message
    : String(error);
}

export function registerProjectSettingsTransferImportRoutes(
  router,
  {
    settingsTransferService,
    adminAuth,
    securityService,
    maxBodyBytes,
    afterImport,
  },
) {
  router.post(
    '/admin/settings/import',
    adminAuth.requireSuperuser,
    createAdminOperationAudit(
      securityService,
      'settings.import',
    ),
    express.json({
      limit:
        Math.min(
          maxBodyBytes,
          2 * 1024 * 1024,
        ),
      strict: true,
      inflate: true,
      type: 'application/json',
    }),
    async (
      request,
      response,
      next,
    ) => {
      if (
        request.body ===
        undefined
      ) {
        response
          .status(415)
          .json({
            error:
              'Content-Type must be application/json',
          });
        return;
      }

      try {
        const before =
          await settingsTransferService
            .exportSettings();
        const imported =
          await settingsTransferService
            .importSettings(
              request.body,
            );
        const after =
          await settingsTransferService
            .exportSettings();

        recordAdminOperationChanges(
          response,
          {
            projectSettings:
              before.projectSettings,
            lineTypes:
              before.lineTypes,
            reportConfig:
              before.reportConfig,
          },
          {
            projectSettings:
              after.projectSettings,
            lineTypes:
              after.lineTypes,
            reportConfig:
              after.reportConfig,
          },
        );

        recordAdminOperationDetails(
          response,
          {
            importSummary:
              imported,
            securityDetailsExcluded:
              true,
          },
        );

        let derived = null;
        const warnings = [];

        if (afterImport) {
          try {
            derived =
              await afterImport(
                imported,
              ) ?? null;
          } catch (error) {
            warnings.push({
              phase:
                'public-downloads',
              message:
                errorMessage(error),
            });
          }
        }

        response
          .set(
            'Cache-Control',
            'no-store',
          );
        response.json({
          imported,
          derived,
          warnings,
        });
      } catch (error) {
        if (
          isProjectSettingsTransferInputValidationError(
            error,
          )
        ) {
          response
            .status(400)
            .json({
              error:
                error.message,
            });
          return;
        }

        next(error);
      }
    },
  );
}
