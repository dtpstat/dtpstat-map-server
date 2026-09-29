import crypto from 'node:crypto';

const LEVELS =
  new Set([
    'info',
    'log',
    'warn',
    'error',
  ]);

const CONTROL_ACTIONS =
  new Set([
    'refresh-session',
    'logout',
  ]);

const PERMISSIONS =
  new Set([
    'any',
    'profile',
    'data',
    'interface',
    'osm-editor',
    'geometry-editor',
    'users',
    'audit',
    'users-or-audit',
    'security',
    'superuser',
  ]);

const DEFAULT_TIMEOUTS =
  Object.freeze({
    info: 5_000,
    log: 4_000,
    warn: 0,
    error: 0,
  });

function stringValue(
  value,
  {
    fallback = null,
    maxLength = 2_000,
  } = {},
) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return fallback;
  }

  const result =
    String(value).trim();

  if (!result) return fallback;
  return result.slice(
    0,
    maxLength,
  );
}

function positiveIds(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return [
    ...new Set(
      values
        .map(Number)
        .filter(
          (value) =>
            Number.isSafeInteger(value) &&
            value > 0,
        ),
    ),
  ].slice(0, 100);
}

function audienceValue(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    return null;
  }

  const audience = {
    userIds:
      positiveIds(
        value.userIds,
      ),
    sessionIds:
      positiveIds(
        value.sessionIds,
      ),
    excludeSessionIds:
      positiveIds(
        value.excludeSessionIds,
      ),
  };

  return (
    audience.userIds.length ||
    audience.sessionIds.length ||
    audience.excludeSessionIds.length
  )
    ? audience
    : null;
}

function controlValue(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    return null;
  }

  const action =
    stringValue(
      value.action,
      {
        maxLength: 64,
      },
    );

  if (
    !CONTROL_ACTIONS.has(
      action,
    )
  ) {
    throw new TypeError(
      'Unsupported notification control action',
    );
  }

  return {
    action,
    reason:
      stringValue(
        value.reason,
        {
          maxLength: 160,
        },
      ),
  };
}

function sourceValue(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    return null;
  }

  const kind =
    stringValue(
      value.kind,
      {
        maxLength: 80,
      },
    );
  if (!kind) return null;

  return {
    kind,
    id:
      stringValue(
        value.id,
        {
          maxLength: 160,
        },
      ),
  };
}

export function normalizeAdminNotification(
  definition,
  dependencies = {},
) {
  if (
    !definition ||
    typeof definition !== 'object' ||
    Array.isArray(definition)
  ) {
    throw new TypeError(
      'Notification definition must be an object',
    );
  }

  const level =
    stringValue(
      definition.level ??
      definition.type,
      {
        fallback:
          'info',
        maxLength: 16,
      },
    );

  if (!LEVELS.has(level)) {
    throw new TypeError(
      'Unsupported notification level',
    );
  }

  const message =
    stringValue(
      definition.message,
      {
        maxLength: 2_000,
      },
    );
  if (!message) {
    throw new TypeError(
      'Notification message is required',
    );
  }

  const persistent =
    level === 'warn' ||
    level === 'error'
      ? true
      : Boolean(
        definition.persistent,
      );

  const requestedTimeout =
    Number(
      definition.timeoutMs,
    );

  const timeoutMs =
    persistent
      ? 0
      : Number.isFinite(
        requestedTimeout,
      ) &&
        requestedTimeout >= 1_000
        ? Math.min(
          60_000,
          Math.floor(
            requestedTimeout,
          ),
        )
        : DEFAULT_TIMEOUTS[
          level
        ];

  const permission =
    stringValue(
      definition.permission,
      {
        fallback:
          'any',
        maxLength: 64,
      },
    );

  if (
    !PERMISSIONS.has(
      permission,
    )
  ) {
    throw new TypeError(
      'Unsupported notification permission',
    );
  }

  return {
    type:
      'notification',
    notification: {
      id:
        stringValue(
          definition.id,
          {
            maxLength: 160,
          },
        ) ??
        dependencies
          .randomUUID?.() ??
        crypto.randomUUID(),
      level,
      message,
      persistent,
      timeoutMs,
      createdAt:
        stringValue(
          definition.createdAt,
          {
            maxLength: 64,
          },
        ) ??
        dependencies
          .now?.() ??
        new Date()
          .toISOString(),
      code:
        stringValue(
          definition.code,
          {
            maxLength: 120,
          },
        ),
      control:
        controlValue(
          definition.control,
        ),
      source:
        sourceValue(
          definition.source,
        ),
    },
    delivery: {
      permission,
      audience:
        audienceValue(
          definition.audience,
        ),
    },
  };
}

export function createAdminNotificationChannel(
  dependencies = {},
) {
  const listeners =
    new Set();

  return {
    publish(definition) {
      const event =
        normalizeAdminNotification(
          definition,
          dependencies,
        );

      for (
        const listener of
        listeners
      ) {
        try {
          listener(
            structuredClone(
              event,
            ),
          );
        } catch (error) {
          console.error(
            'Admin notification listener failed',
            error,
          );
        }
      }

      return structuredClone(
        event.notification,
      );
    },

    subscribe(listener) {
      if (
        typeof listener !==
        'function'
      ) {
        throw new TypeError(
          'Notification listener must be a function',
        );
      }

      listeners.add(listener);
      return () =>
        listeners.delete(listener);
    },
  };
}
