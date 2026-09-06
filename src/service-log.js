const LEVEL_METHODS = Object.freeze({
  info: 'info',
  warning: 'warn',
  error: 'error',
});

/** @param {unknown} error */
export function serviceErrorDetails(error) {
  return {
    name: error instanceof Error ? error.name : 'Error',
    code:
      error && typeof error === 'object' && 'code' in error
        ? error.code ?? null
        : null,
    message: error instanceof Error ? error.message : String(error),
  };
}

/**
 * Emit one grep-friendly server-side service event. Keep secrets out of details.
 * systemd/journald already adds wall-clock timestamps, so the application only
 * adds an event namespace and structured details.
 *
 * @param {'info' | 'warning' | 'error'} level
 * @param {string} event
 * @param {object} [details]
 * @param {Pick<Console, 'info' | 'warn' | 'error'>} [output]
 */
export function serviceLog(level, event, details = {}, output = console) {
  const method = LEVEL_METHODS[level] ?? LEVEL_METHODS.info;
  output[method](`[service] ${event}`, details);
}

/**
 * Emit exactly one JSON object on one line for security tooling such as fail2ban.
 * Do not include passwords, session tokens, temporary passwords, hashes or other
 * secrets in details.
 *
 * @param {string} event
 * @param {object} [details]
 * @param {Pick<Console, 'warn'>} [output]
 */
export function securityLog(event, details = {}, output = console) {
  output.warn(`[security] ${JSON.stringify({ event, ...details })}`);
}

/**
 * Log the start, successful completion and failure of an internal operation.
 *
 * @template T
 * @param {string} event
 * @param {() => Promise<T>} operation
 * @param {{
 *   details?: object,
 *   successDetails?: (result: T) => object,
 *   now?: () => number,
 *   output?: Pick<Console, 'info' | 'warn' | 'error'>
 * }} [options]
 * @returns {Promise<T>}
 */
export async function runServiceOperation(event, operation, options = {}) {
  const now = options.now ?? Date.now;
  const output = options.output ?? console;
  const startedAt = now();
  serviceLog('info', `${event}:start`, options.details ?? {}, output);

  try {
    const result = await operation();
    serviceLog(
      'info',
      `${event}:ok`,
      {
        ...(options.successDetails?.(result) ?? {}),
        durationMs: Math.max(0, now() - startedAt),
      },
      output,
    );
    return result;
  } catch (error) {
    serviceLog(
      'error',
      `${event}:error`,
      {
        ...serviceErrorDetails(error),
        durationMs: Math.max(0, now() - startedAt),
      },
      output,
    );
    throw error;
  }
}
