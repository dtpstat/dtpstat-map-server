export class AdminTaskAlreadyRunningError extends Error {
  /** @param {object} task */
  constructor(task) {
    super(
      `Admin task ${task.id} is already ${task.status}`,
    );
    this.name = 'AdminTaskAlreadyRunningError';
    this.task = task;
  }
}

export class AdminTaskCancelledError extends Error {
  constructor(
    message = 'Admin task was cancelled',
  ) {
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
export function adminTaskSnapshot(task) {
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
  if (task.result !== undefined) {
    value.result = task.result;
  }
  if (task.error !== undefined) {
    value.error = task.error;
  }

  return structuredClone(value);
}

/** @param {string} status */
export function isAdminTaskActiveStatus(status) {
  return (
    status === 'queued' ||
    status === 'running' ||
    status === 'cancelling'
  );
}

export function elapsedAdminTaskMilliseconds(
  startedAt,
  completedAt,
) {
  const start = Date.parse(startedAt);
  const end = Date.parse(completedAt);

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end)
  ) {
    return null;
  }

  return Math.max(0, end - start);
}
