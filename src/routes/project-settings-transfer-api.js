import express, { Router } from 'express';
import { AdminSecurityValidationError } from '../data/admin-security.js';
import { LineTypeValidationError } from '../data/line-types.js';
import { ProjectSettingsValidationError } from '../data/project-settings.js';
import { ReportConfigValidationError } from '../data/report-config.js';
import { ProjectSettingsTransferValidationError } from '../db/project-settings-transfer-service.js';
import { createAdminOperationAudit } from '../http/admin-auth.js';

function isValidationError(error) {
  return error instanceof ProjectSettingsTransferValidationError ||
    error instanceof ProjectSettingsValidationError ||
    error instanceof LineTypeValidationError ||
    error instanceof ReportConfigValidationError ||
    error instanceof AdminSecurityValidationError;
}

/**
 * @param {{
 *   settingsTransferService: { exportSettings: () => Promise<object>, importSettings: (payload: unknown) => Promise<object> },
 *   adminAuth: ReturnType<import('../http/admin-auth.js').createAdminAuthorization>,
 *   securityService: ReturnType<import('../data/admin-security.js').createAdminSecurityService>,
 *   maxBodyBytes: number,
 *   afterImport?: (result: object) => Promise<object | void>
 * }} dependencies
 */
export function createProjectSettingsTransferRouter({
  settingsTransferService,
  adminAuth,
  securityService,
  maxBodyBytes,
  afterImport,
}) {
  const router = Router();
  const operationAudit = (type) => createAdminOperationAudit(securityService, type);

  router.get(
    '/admin/settings/export',
    adminAuth.requireSuperuser,
    operationAudit('settings.export'),
    async (_request, response, next) => {
      try {
        const payload = await settingsTransferService.exportSettings();
        response
          .set('Cache-Control', 'no-store')
          .set('Content-Disposition', 'attachment; filename="project-settings.json"')
          .type('application/json')
          .send(`${JSON.stringify(payload, null, 2)}\n`);
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/admin/settings/import',
    adminAuth.requireSuperuser,
    operationAudit('settings.import'),
    express.json({
      limit: Math.min(maxBodyBytes, 2 * 1024 * 1024),
      strict: true,
      inflate: true,
      type: 'application/json',
    }),
    async (request, response, next) => {
      if (request.body === undefined) {
        response.status(415).json({ error: 'Content-Type must be application/json' });
        return;
      }
      try {
        const imported = await settingsTransferService.importSettings(request.body);
        let derived = null;
        if (afterImport) derived = await afterImport(imported) ?? null;
        response.set('Cache-Control', 'no-store');
        response.json({ imported, derived });
      } catch (error) {
        if (isValidationError(error)) {
          response.status(400).json({ error: error.message });
          return;
        }
        next(error);
      }
    },
  );

  return router;
}
