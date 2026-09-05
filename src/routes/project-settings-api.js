import express, { Router } from 'express';
import {
  PROJECT_CONTENT_CLASSES,
  PROJECT_CONTENT_TAGS,
  ProjectSettingsValidationError,
} from '../data/project-settings.js';
import { createBasicAuth } from '../http/basic-auth.js';

/**
 * @param {{
 *   projectSettingsRepository: { get: () => Promise<any>, save: (payload: unknown) => Promise<any> },
 *   adminTasks: ReturnType<import('../data/admin-task-manager.js').createAdminTaskManager>,
 *   importApi: { username: string, password: string, maxBodyBytes: number }
 * }} dependencies
 */
export function createProjectSettingsRouter({
  projectSettingsRepository,
  adminTasks,
  importApi,
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

  router.get('/project', async (_request, response, next) => {
    try {
      const settings = await projectSettingsRepository.get();
      response.set('Cache-Control', 'no-cache');
      response.json(settings);
    } catch (error) {
      next(error);
    }
  });

  router.get(
    '/admin/project-settings',
    requireAdminAuth,
    async (_request, response, next) => {
      try {
        const settings = await projectSettingsRepository.get();
        response.set('Cache-Control', 'no-store');
        response.json({
          settings,
          editor: {
            tags: PROJECT_CONTENT_TAGS,
            classes: PROJECT_CONTENT_CLASSES,
          },
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.put(
    '/admin/project-settings',
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
        const settings = await projectSettingsRepository.save(request.body);
        response.set('Cache-Control', 'no-store');
        response.json({ settings });
      } catch (error) {
        if (error instanceof ProjectSettingsValidationError) {
          response.status(400).json({ error: error.message });
          return;
        }
        next(error);
      }
    },
  );

  return router;
}
