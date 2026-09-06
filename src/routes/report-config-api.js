import express, { Router } from 'express';
import {
  publicReportConfig,
  REPORT_CONFIG_CATALOG,
  ReportConfigValidationError,
} from '../data/report-config.js';
import { createAdminOperationAudit } from '../http/admin-auth.js';

/**
 * @param {{
 *   reportConfigService: { get: () => Promise<any>, save: (payload: unknown) => Promise<any> },
 *   lineTypesRepository: { list: () => Promise<any[]> },
 *   adminAuth: ReturnType<import('../http/admin-auth.js').createAdminAuthorization>,
 *   securityService: ReturnType<import('../data/admin-security.js').createAdminSecurityService>,
 *   maxBodyBytes: number,
 *   afterSave?: (result: any) => Promise<any>
 * }} dependencies
 */
export function createReportConfigRouter({
  reportConfigService,
  lineTypesRepository,
  adminAuth,
  securityService,
  maxBodyBytes,
  afterSave = async () => undefined,
}) {
  const router = Router();
  const jsonBody = express.json({
    limit: Math.min(maxBodyBytes, 256 * 1024),
    strict: true,
    inflate: true,
    type: 'application/json',
  });

  router.get('/report-config', async (_request, response, next) => {
    try {
      const config = await reportConfigService.get();
      response.set('Cache-Control', 'no-cache');
      response.json(publicReportConfig(config));
    } catch (error) {
      next(error);
    }
  });

  router.get(
    '/admin/report-config',
    adminAuth.requireInterface,
    async (_request, response, next) => {
      try {
        const [config, lineTypes] = await Promise.all([
          reportConfigService.get(),
          lineTypesRepository.list(),
        ]);
        response.set('Cache-Control', 'no-store');
        response.json({
          config,
          catalog: REPORT_CONFIG_CATALOG,
          lineTypes: lineTypes.map(({ code, name, title }) => ({ code, name, title })),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.put(
    '/admin/report-config',
    adminAuth.requireInterface,
    createAdminOperationAudit(securityService, 'interface.report.update'),
    jsonBody,
    async (request, response, next) => {
      try {
        const result = await reportConfigService.save(request.body);
        const snapshots = await afterSave(result);
        response.set('Cache-Control', 'no-store');
        response.json({
          config: result.config,
          materialized: result.materialized,
          snapshots: snapshots ?? null,
        });
      } catch (error) {
        if (error instanceof ReportConfigValidationError) {
          response.status(400).json({ error: error.message });
          return;
        }
        next(error);
      }
    },
  );

  return router;
}
