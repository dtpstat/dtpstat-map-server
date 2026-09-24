import crypto from 'node:crypto';
import {
  sanitizeAdminAuditData,
  sanitizeAdminAuditLog,
} from '../logging/admin-audit-details.js';
import { serviceLog } from '../../service-log.js';
import {
  AdminTaskAlreadyRunningError,
  AdminTaskCancelledError,
  adminTaskSnapshot,
  elapsedAdminTaskMilliseconds,
  isAdminTaskActiveStatus,
  throwIfAdminTaskCancelled,
} from './admin-task-policy.js';

export {
  AdminTaskAlreadyRunningError,
  AdminTaskCancelledError,
  throwIfAdminTaskCancelled,
};

export function createAdminTaskManager(dependencies = {}) {
  const randomUUID = dependencies.randomUUID ?? crypto.randomUUID;
  const schedule = dependencies.schedule ?? setImmediate;
  const now = dependencies.now ?? (() => new Date().toISOString());
  const recordSuccessfulUpdate = dependencies.recordSuccessfulUpdate;
  const afterSuccessfulUpdate = dependencies.afterSuccessfulUpdate;
  const recordTaskAudit = dependencies.recordTaskAudit;
  const listeners = new Set();
  const successfulUpdates = new Map(
    (dependencies.initialSuccessfulUpdates ?? []).map((update) => [
      update.taskType,
      structuredClone(update),
    ]),
  );
  let currentTask = null;

  function successfulUpdatesSnapshot() {
    return Object.fromEntries(
      [...successfulUpdates.entries()].map(([taskType, update]) => [
        taskType,
        structuredClone(update),
      ]),
    );
  }

  /** @param {object} event */
  function emit(event) {
    for (const listener of listeners) {
      try {
        listener(structuredClone(event));
      } catch (error) {
        console.error('Admin task event listener failed', error);
      }
    }
  }

  /** @param {any} task @param {string} level @param {string} message @param {object | undefined} details */
  function appendLog(task, level, message, details) {
    const entry = {
      sequence: task.log.length + 1,
      timestamp: now(),
      level,
      message,
    };
    if (details !== undefined) entry.details = structuredClone(details);
    task.log.push(entry);
    emit({ type: 'log', taskId: task.id, entry });
  }

  async function persistTaskAudit(task) {
    if (!task.actor) return;
    const durationMs = elapsedAdminTaskMilliseconds(
      task.startedAt ?? task.createdAt,
      task.completedAt,
    );
    const details = {
      taskId: task.id,
      endpoint: task.endpoint,
      parameters: sanitizeAdminAuditData(task.parameters),
      ...(task.result !== undefined
        ? { changeSummary: sanitizeAdminAuditData(task.result) }
        : {}),
      ...(task.error !== undefined
        ? { error: sanitizeAdminAuditData(task.error) }
        : {}),
    };
    const auditDetails = {
      ...details,
      taskLog: sanitizeAdminAuditLog(task.log),
    };
    serviceLog(task.status === 'succeeded' ? 'info' : 'warning', 'admin.data-operation', {
      operationType: task.type,
      status: task.status,
      durationMs,
      ipAddress: task.actor.ipAddress ?? null,
      userId: task.actor.userId ?? null,
      username: task.actor.username ?? null,
      ...details,
      taskLogEntries: task.log.length,
    });
    if (!recordTaskAudit) return;
    try {
      await recordTaskAudit({
        eventType: 'operation',
        operationType: task.type,
        status: task.status,
        durationMs,
        ipAddress: task.actor.ipAddress ?? null,
        userId: task.actor.userId ?? null,
        username: task.actor.username ?? null,
        details: auditDetails,
      });
    } catch (error) {
      appendLog(task, 'warning', 'Не удалось записать аудит admin-операции', {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** @param {any} task @param {(context: object) => Promise<object>} executor */
  async function run(task, executor) {
    if (task.controller.signal.aborted) {
      task.status = 'cancelled';
      task.completedAt = now();
      appendLog(task, 'warning', 'Задача отменена до запуска');
      await persistTaskAudit(task);
      emit({ type: 'task', task: adminTaskSnapshot(task) });
      return;
    }

    task.status = 'running';
    task.startedAt = now();
    emit({ type: 'task', task: adminTaskSnapshot(task) });
    appendLog(task, 'info', 'Задача запущена');
    const context = {
      signal: task.controller.signal,
      /** @param {string} message @param {object} [details] @param {'info' | 'warning' | 'error'} [level] */
      log(message, details, level = 'info') {
        appendLog(task, level, message, details);
      },
      beginCommit() {
        throwIfAdminTaskCancelled(task.controller.signal);
        task.cancellable = false;
        appendLog(task, 'info', 'Начата атомарная фиксация изменений');
        emit({ type: 'task', task: adminTaskSnapshot(task) });
      },
    };

    try {
      task.result = await executor(context);
      throwIfAdminTaskCancelled(task.controller.signal);
      const completedAt = now();
      let successfulUpdate = null;

      if (task.recordsSuccessfulUpdate) {
        successfulUpdate = {
          taskType: task.type,
          taskId: task.id,
          endpoint: task.endpoint,
          completedAt,
        };
        successfulUpdates.set(task.type, successfulUpdate);
        if (recordSuccessfulUpdate) {
          try {
            await recordSuccessfulUpdate(structuredClone(successfulUpdate));
          } catch (error) {
            appendLog(task, 'warning', 'Не удалось сохранить отметку успешного обновления', {
              message: error instanceof Error ? error.message : String(error),
            });
          }
        }
        if (afterSuccessfulUpdate) {
          try {
            const details = await afterSuccessfulUpdate(
              structuredClone(successfulUpdate),
            );
            if (details !== undefined) {
              appendLog(task, 'info', 'Производные публичные данные обновлены', details);
            }
          } catch (error) {
            appendLog(task, 'warning', 'Не удалось обновить производные публичные данные', {
              message: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }

      task.status = 'succeeded';
      task.completedAt = completedAt;
      if (task.result?.partial) {
        appendLog(
          task,
          'warning',
          'Задача завершена с предупреждениями',
          {
            warningCount: task.result.warningCount ?? 0,
            skippedCount: task.result.skippedCount ?? 0,
          },
        );
      } else {
        appendLog(task, 'info', 'Задача успешно завершена');
      }
      if (successfulUpdate) emit({ type: 'success', update: successfulUpdate });
    } catch (error) {
      if (
        task.controller.signal.aborted ||
        error instanceof AdminTaskCancelledError
      ) {
        task.status = 'cancelled';
        appendLog(task, 'warning', 'Задача отменена');
      } else {
        task.status = 'failed';
        task.error = {
          name: error instanceof Error ? error.name : 'Error',
          message: error instanceof Error ? error.message : String(error),
        };
        appendLog(task, 'error', 'Задача завершилась с ошибкой', task.error);
      }
    } finally {
      task.completedAt ??= now();
      await persistTaskAudit(task);
      if (currentTask === task) {
        emit({ type: 'task', task: adminTaskSnapshot(task) });
      }
    }
  }

  return {
    /**
     * @param {{
     *   type: string,
     *   endpoint: string,
     *   parameters?: object,
     *   recordsSuccessfulUpdate?: boolean,
     *   actor?: { userId?: number, username?: string, ipAddress?: string | null }
     * }} definition
     * @param {(context: { signal: AbortSignal, log: Function, beginCommit: Function }) => Promise<object>} executor
     */
    start(definition, executor) {
      if (currentTask !== null && isAdminTaskActiveStatus(currentTask.status)) {
        throw new AdminTaskAlreadyRunningError(adminTaskSnapshot(currentTask));
      }

      const task = {
        id: randomUUID(),
        type: definition.type,
        endpoint: definition.endpoint,
        parameters: structuredClone(definition.parameters ?? {}),
        actor: definition.actor ? structuredClone(definition.actor) : null,
        status: 'queued',
        createdAt: now(),
        startedAt: null,
        completedAt: null,
        cancellable: true,
        recordsSuccessfulUpdate: definition.recordsSuccessfulUpdate ?? true,
        log: [],
        controller: new AbortController(),
      };
      currentTask = task;
      appendLog(task, 'info', 'Задача принята сервером');
      emit({ type: 'task', task: adminTaskSnapshot(task) });
      schedule(() => {
        void run(task, executor);
      });
      return adminTaskSnapshot(task);
    },

    active() {
      return currentTask !== null && isAdminTaskActiveStatus(currentTask.status)
        ? adminTaskSnapshot(currentTask)
        : null;
    },

    /** @param {string} taskId */
    get(taskId) {
      return currentTask?.id === taskId ? adminTaskSnapshot(currentTask) : null;
    },

    current() {
      return currentTask ? adminTaskSnapshot(currentTask) : null;
    },

    clearCompleted() {
      if (currentTask === null || isAdminTaskActiveStatus(currentTask.status)) {
        return false;
      }
      currentTask = null;
      emit({ type: 'task', task: null });
      return true;
    },

    successfulUpdates() {
      return successfulUpdatesSnapshot();
    },

    /** @param {string} taskId */
    cancel(taskId) {
      if (currentTask?.id !== taskId) return null;
      if (!isAdminTaskActiveStatus(currentTask.status)) {
        return { accepted: false, task: adminTaskSnapshot(currentTask) };
      }
      if (!currentTask.cancellable) {
        return { accepted: false, task: adminTaskSnapshot(currentTask) };
      }
      if (currentTask.status !== 'cancelling') {
        currentTask.status = 'cancelling';
        appendLog(currentTask, 'warning', 'Запрошена отмена задачи');
        currentTask.controller.abort(new AdminTaskCancelledError());
        emit({ type: 'task', task: adminTaskSnapshot(currentTask) });
      }
      return { accepted: true, task: adminTaskSnapshot(currentTask) };
    },

    /** @param {(event: object) => void} listener */
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

