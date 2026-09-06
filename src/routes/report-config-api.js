import express, { Router } from 'express';
import {
  publicReportConfig,
  REPORT_CONFIG_CATALOG,
  ReportConfigValidationError,
} from '../data/report-config.js';
import { createBasicAuth } from '../http/basic-auth.js';

/**
 * @param {{
 *   reportConfigService: { get: () => Promise<any>, save: (payload: unknown) => Promise<any> },
 *   lineTypesRepository: { list: () => Promise<any[]> },
 *   adminTasks: ReturnType<import('../data/admin-task-manager.js').createAdminTaskManager>,
 *   importApi: { username: string, password: string, maxBodyBytes: number },
 *   afterSave?: (result: any) => Promise<any>
 * }} dependencies
 */
export function createReportConfigRouter({
  reportConfigService,
  lineTypesRepository,
  adminTasks,
  importApi,
  afterSave = async () => undefined,
}) {
  const router = Router();
  const requireAdminAuth = createBasicAuth({
    username: importApi.username,
    password: importApi.password,
    realm: 'data-import',
  });
  const jsonBody = express.json({
    limit: Math.min(importApi.maxBodyBytes, 256 * 1024),
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
    requireAdminAuth,
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
    requireAdminAuth,
    jsonBody,
    async (request, response, next) => {
      const activeTask = adminTasks.active();
      if (activeTask) {
        response.status(409).json({
          error: 'Another admin task is already active',
          taskId: activeTask.id,
          task: {
            id: activeTask.id,
            type: activeTask.type,
            status: activeTask.status,
          },
        });
        return;
      }

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
