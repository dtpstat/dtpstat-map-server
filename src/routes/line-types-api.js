import express, { Router } from 'express';
import { LineTypeValidationError } from '../data/line-types.js';
import { createBasicAuth } from '../http/basic-auth.js';

/**
 * @param {{
 *   lineTypesRepository: { list: () => Promise<any[]>, save: (payload: unknown) => Promise<any[]> },
 *   adminTasks: ReturnType<import('../data/admin-task-manager.js').createAdminTaskManager>,
 *   importApi: { username: string, password: string, maxBodyBytes: number }
 * }} dependencies
 */
export function createLineTypesRouter({
  lineTypesRepository,
  adminTasks,
  importApi,
}) {
  const router = Router();
  const requireAdminAuth = createBasicAuth({
    username: importApi.username,
    password: importApi.password,
  });

  router.get('/line-types', async (_request, response, next) => {
    try {
      response.set('Cache-Control', 'no-store');
      response.json({ lineTypes: await lineTypesRepository.list() });
    } catch (error) {
      next(error);
    }
  });

  router.put(
    '/admin/line-types',
    requireAdminAuth,
    (request, response, next) => {
      const task = adminTasks.active();
      if (!task) {
        next();
        return;
      }
      response.set('Cache-Control', 'no-store');
      response.status(409).json({
        error: 'Another admin task is already active',
        taskId: task.id,
        task: {
          id: task.id,
          type: task.type,
          status: task.status,
        },
      });
    },
    express.json({
      limit: Math.min(importApi.maxBodyBytes, 256 * 1024),
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
        const lineTypes = await lineTypesRepository.save(request.body);
        response.set('Cache-Control', 'no-store');
        response.json({ lineTypes });
      } catch (error) {
        if (error instanceof LineTypeValidationError) {
          response.status(400).json({ error: error.message });
          return;
        }
        next(error);
      }
    },
  );

  return router;
}
