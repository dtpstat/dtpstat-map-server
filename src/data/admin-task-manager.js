import crypto from 'node:crypto';

export class AdminTaskAlreadyRunningError extends Error {
  /** @param {object} task */
  constructor(task) {
    super(`Admin task ${task.id} is already ${task.status}`);
    this.name = 'AdminTaskAlreadyRunningError';
    this.task = task;
  }
}

export class AdminTaskCancelledError extends Error {
  constructor(message = 'Admin task was cancelled') {
    super(message);
    this.name = 'AdminTaskCancelledError';
  }
}

/** @param {AbortSignal | undefined} signal */
export function throwIfAdminTaskCancelled(signal) {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new AdminTaskCancelledError();
}

/** @param {any} task */
function snapshot(task) {
  const value = {
    id: task.id,
    type: task.type,
    endpoint: task.endpoint,
    status: task.status,
    parameters: task.parameters,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    cancellable: task.cancellable,
    log: task.log,
  };
  if (task.actor) value.actor = task.actor;
  if (task.result !== undefined) value.result = task.result;
  if (task.error !== undefined) value.error = task.error;
  return structuredClone(value);
}

/** @param {string} status */
function activeStatus(status) {
  return status === 'queued' || status === 'running' || status === 'cancelling';
}

function elapsedMilliseconds(startedAt, completedAt) {
  const start = Date.parse(startedAt);
  const end = Date.parse(completedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, end - start);
}

/**
 * Run every mutating data-management operation through one process-local
 * single-task guard. Interface settings are intentionally outside this lock.
 * The last task and its complete log remain available after completion and are
 * discarded only when the next data task is accepted.
 *
 * @param {{
 *   randomUUID?: () => string,
 *   schedule?: (callback: () => void) => void,
 *   now?: () => string,
 *   initialSuccessfulUpdates?: Array<{
 *     taskType: string,
 *     taskId: string | null,
 *     endpoint: string,
 *     completedAt: string
 *   }>,
 *   recordSuccessfulUpdate?: (update: object) => Promise<unknown>,
 *   afterSuccessfulUpdate?: (update: object) => Promise<object | void>,
 *   recordTaskAudit?: (entry: object) => Promise<unknown>
 * }} [dependencies]
 */
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
    if (!recordTaskAudit || !task.actor) return;
    try {
      await recordTaskAudit({
        eventType: 'operation',
        operationType: task.type,
        status: task.status,
        durationMs: elapsedMilliseconds(
          task.startedAt ?? task.createdAt,
          task.completedAt,
        ),
        ipAddress: task.actor.ipAddress ?? null,
        userId: task.actor.userId ?? null,
        username: task.actor.username ?? null,
        details: {
          taskId: task.id,
          endpoint: task.endpoint,
          parameters: task.parameters,
        },
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
      emit({ type: 'task', task: snapshot(task) });
      return;
    }

    task.status = 'running';
    task.startedAt = now();
    emit({ type: 'task', task: snapshot(task) });
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
        emit({ type: 'task', task: snapshot(task) });
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
      appendLog(task, 'info', 'Задача успешно завершена');
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
      emit({ type: 'task', task: snapshot(task) });
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
      if (currentTask !== null && activeStatus(currentTask.status)) {
        throw new AdminTaskAlreadyRunningError(snapshot(currentTask));
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
      emit({ type: 'task', task: snapshot(task) });
      schedule(() => {
        void run(task, executor);
      });
      return snapshot(task);
    },

    active() {
      return currentTask !== null && activeStatus(currentTask.status)
        ? snapshot(currentTask)
        : null;
    },

    /** @param {string} taskId */
    get(taskId) {
      return currentTask?.id === taskId ? snapshot(currentTask) : null;
    },

    current() {
      return currentTask ? snapshot(currentTask) : null;
    },

    successfulUpdates() {
      return successfulUpdatesSnapshot();
    },

    /** @param {string} taskId */
    cancel(taskId) {
      if (currentTask?.id !== taskId) return null;
      if (!activeStatus(currentTask.status)) {
        return { accepted: false, task: snapshot(currentTask) };
      }
      if (!currentTask.cancellable) {
        return { accepted: false, task: snapshot(currentTask) };
      }
      if (currentTask.status !== 'cancelling') {
        currentTask.status = 'cancelling';
        appendLog(currentTask, 'warning', 'Запрошена отмена задачи');
        currentTask.controller.abort(new AdminTaskCancelledError());
        emit({ type: 'task', task: snapshot(currentTask) });
      }
      return { accepted: true, task: snapshot(currentTask) };
    },

    /** @param {(event: object) => void} listener */
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
