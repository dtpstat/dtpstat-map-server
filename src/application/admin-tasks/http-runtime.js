import {
  AdminTaskAlreadyRunningError,
} from '../../data/admin-task-manager.js';
import {
  adminClientIp,
  createAdminOperationAudit,
} from '../../http/admin-auth.js';

export function createAdminTaskHttpRuntime({
  adminTasks,
  securityService,
}) {
  const adminStatusURL = (request, taskId) =>
    `${request.baseUrl}/admin/status/${taskId}`;

  const operationAudit = (type) =>
    createAdminOperationAudit(securityService, type);

  const respondWithActiveTask = (request, response, task) => {
    const statusURL = adminStatusURL(request, task.id);
    response.set('Cache-Control', 'no-store');
    response.status(409).json({
      error: 'Another data-management task is already active',
      taskId: task.id,
      task: {
        id: task.id,
        type: task.type,
        status: task.status,
      },
      statusURL,
    });
  };

  const rejectWhileAdminTaskActive = (request, response, next) => {
    const activeTask = adminTasks.active();
    if (activeTask) {
      respondWithActiveTask(request, response, activeTask);
      return;
    }
    next();
  };

  const clearCompletedAdminTask = (_request, _response, next) => {
    adminTasks.clearCompleted?.();
    next();
  };

  const actorFor = (request) => request.adminUser
    ? {
        userId: request.adminUser.id,
        username: request.adminUser.username,
        ipAddress: adminClientIp(request),
      }
    : undefined;

  const startAdminTask = (
    request,
    response,
    next,
    definition,
    executor,
  ) => {
    try {
      const task = adminTasks.start(
        {
          ...definition,
          actor: actorFor(request),
        },
        executor,
      );
      const statusURL = adminStatusURL(request, task.id);
      response.set('Cache-Control', 'no-store');
      response.location(statusURL);
      response.status(202).json({
        status: 'accepted',
        taskId: task.id,
        task: { ...task, statusURL },
      });
      return task;
    } catch (error) {
      if (error instanceof AdminTaskAlreadyRunningError) {
        respondWithActiveTask(request, response, error.task);
        return null;
      }
      next(error);
      return null;
    }
  };

  return {
    adminStatusURL,
    clearCompletedAdminTask,
    operationAudit,
    rejectWhileAdminTaskActive,
    startAdminTask,
  };
}
