const LEVELS =
  new Set([
    'info',
    'log',
    'warn',
    'error',
  ]);

const LEGACY_LEVELS =
  Object.freeze({
    success: 'info',
    warning: 'warn',
  });

const DEFAULT_TIMEOUTS =
  Object.freeze({
    info: 5_000,
    log: 4_000,
    warn: 0,
    error: 0,
  });

function normalizedLevel(value) {
  const raw =
    String(
      value ??
      'info',
    ).toLowerCase();
  const level =
    LEGACY_LEVELS[raw] ??
    raw;

  return LEVELS.has(level)
    ? level
    : 'info';
}

function normalizedNotification(
  definition,
  {
    randomUUID,
    now,
  },
) {
  const source =
    typeof definition === 'string'
      ? {
        message:
          definition,
      }
      : (
        definition &&
        typeof definition === 'object' &&
        !Array.isArray(definition)
          ? definition
          : {}
      );

  const message =
    String(
      source.message ??
      source.text ??
      '',
    )
      .trim()
      .slice(
        0,
        2_000,
      );

  if (!message) {
    return null;
  }

  const level =
    normalizedLevel(
      source.level ??
      source.type,
    );

  const persistent =
    level === 'warn' ||
    level === 'error'
      ? true
      : Boolean(
        source.persistent,
      );

  const requestedTimeout =
    Number(
      source.timeoutMs,
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

  return {
    id:
      String(
        source.id ??
        randomUUID(),
      ).slice(
        0,
        160,
      ),
    level,
    message,
    persistent,
    timeoutMs,
    createdAt:
      String(
        source.createdAt ??
        now(),
      ).slice(
        0,
        64,
      ),
    code:
      source.code
        ? String(
          source.code,
        ).slice(
          0,
          120,
        )
        : null,
    control:
      source.control &&
      typeof source.control ===
        'object' &&
      !Array.isArray(
        source.control,
      )
        ? structuredClone(
          source.control,
        )
        : null,
    source:
      source.source &&
      typeof source.source ===
        'object' &&
      !Array.isArray(
        source.source,
      )
        ? structuredClone(
          source.source,
        )
        : null,
  };
}

export function createNotificationPool(
  dependencies = {},
) {
  const maxSize =
    Math.max(
      1,
      Math.min(
        100,
        Number(
          dependencies.maxSize ??
          50,
        ) ||
        50,
      ),
    );
  const randomUUID =
    dependencies.randomUUID ??
    (() =>
      globalThis.crypto
        ?.randomUUID?.() ??
      (
        Date.now()
          .toString(36) +
        Math.random()
          .toString(36)
          .slice(2)
      ));
  const now =
    dependencies.now ??
    (() =>
      new Date()
        .toISOString());

  const items =
    new Map();
  const listeners =
    new Set();

  const snapshot = () =>
    [...items.values()]
      .map(
        (item) =>
          structuredClone(
            item,
          ),
      );

  const emit =
    (
      kind,
      notification,
    ) => {
      const event = {
        kind,
        notification:
          notification
            ? structuredClone(
              notification,
            )
            : null,
        notifications:
          snapshot(),
      };

      for (
        const listener of
        listeners
      ) {
        try {
          listener(
            event,
          );
        } catch (error) {
          console.error(
            'Notification subscriber failed',
            error,
          );
        }
      }
    };

  return {
    publish(definition) {
      const notification =
        normalizedNotification(
          definition,
          {
            randomUUID,
            now,
          },
        );

      if (!notification) {
        return null;
      }

      if (
        items.has(
          notification.id,
        )
      ) {
        items.delete(
          notification.id,
        );
      }
      items.set(
        notification.id,
        notification,
      );

      while (
        [...items.values()]
          .filter(
            (item) =>
              !item.persistent,
          )
          .length >
        maxSize
      ) {
        const oldestTransient =
          [...items.entries()]
            .find(
              ([, item]) =>
                !item.persistent,
            );
        if (!oldestTransient) {
          break;
        }
        items.delete(
          oldestTransient[0],
        );
      }

      emit(
        'added',
        notification,
      );
      return structuredClone(
        notification,
      );
    },

    dismiss(id) {
      const key =
        String(id ?? '');
      const current =
        items.get(key);
      if (!current) {
        return false;
      }

      items.delete(key);
      emit(
        'dismissed',
        current,
      );
      return true;
    },

    snapshot,

    subscribe(
      listener,
      {
        replay = true,
      } = {},
    ) {
      if (
        typeof listener !==
        'function'
      ) {
        throw new TypeError(
          'Notification subscriber must be a function',
        );
      }

      listeners.add(
        listener,
      );

      if (replay) {
        queueMicrotask(
          () => {
            if (
              listeners.has(
                listener,
              )
            ) {
              listener({
                kind:
                  'snapshot',
                notification:
                  null,
                notifications:
                  snapshot(),
              });
            }
          },
        );
      }

      return () =>
        listeners.delete(
          listener,
        );
    },
  };
}

const adminNotificationPool =
  createNotificationPool();

export function publishAdminNotification(
  definition,
) {
  return adminNotificationPool
    .publish(definition);
}

export function dismissAdminNotification(
  id,
) {
  return adminNotificationPool
    .dismiss(id);
}

export function subscribeAdminNotifications(
  listener,
  options,
) {
  return adminNotificationPool
    .subscribe(
      listener,
      options,
    );
}

export function adminNotificationSnapshot() {
  return adminNotificationPool
    .snapshot();
}
