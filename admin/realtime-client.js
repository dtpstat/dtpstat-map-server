import {
  ADMIN_API_VERSION,
} from './api-contract-client.js';
import {
  publishAdminNotification,
} from './notification-center.js';

const CLIENT_ID_KEY =
  'dtpstat:realtime-client-id';
const RECONNECT_DELAY_MS = 2000;

const listeners = new Set();
let socket = null;
let reconnectTimer = null;
let started = false;
let lastSnapshot = null;

function storage() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function createClientId() {
  return (
    globalThis.crypto
      ?.randomUUID?.() ??
    `${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`
  );
}

export function realtimeClientId() {
  const store = storage();
  const current =
    store?.getItem(
      CLIENT_ID_KEY,
    );
  if (current) return current;

  const value = createClientId();
  try {
    store?.setItem(
      CLIENT_ID_KEY,
      value,
    );
  } catch {
    // Session correlation is best-effort.
  }
  return value;
}

export function realtimeMutationHeaders(
  headers = {},
) {
  return {
    ...headers,
    'X-DTPStat-Realtime-Client':
      realtimeClientId(),
  };
}

function setConnection(
  status,
  text,
) {
  const element =
    document.querySelector(
      '#connection-state',
    );
  if (!element) return;
  element.className =
    `connection connection-${status}`;
  element.textContent = text;
}

function publishRealtimeNotification(
  message,
) {
  if (
    message?.type ===
      'notification' &&
    message.notification
  ) {
    return publishAdminNotification(
      message.notification,
    );
  }

  const dataChangeResource =
    message?.type ===
      'data-change'
      ? message.change
        ?.resource
      : null;
  const dedicatedNotificationResource =
    [
      'geometry-discussions',
      'osm-boundary-discussions',
      'discussion-inbox',
    ].includes(
      dataChangeResource,
    );

  if (
    message?.type ===
      'data-change' &&
    !dedicatedNotificationResource &&
    message.change
      ?.originClientId !==
      realtimeClientId() &&
    message.change
      ?.message
  ) {
    return publishAdminNotification({
      level: 'info',
      message:
        message.change.message,
      source: {
        kind:
          'realtime-data-change',
        id:
          message.change.id ??
          null,
      },
    });
  }

  if (
    message?.type ===
      'log' &&
    message.entry?.message
  ) {
    const level =
      message.entry.level ===
        'error'
        ? 'error'
        : message.entry.level ===
          'warning'
          ? 'warn'
          : 'log';

    return publishAdminNotification({
      level,
      message:
        message.entry.message,
      source: {
        kind:
          'admin-task-log',
        id:
          message.taskId ??
          null,
      },
    });
  }

  if (
    message?.type ===
      'task' &&
    message.task
  ) {
    const taskType =
      String(
        message.task.type ??
        'admin-task',
      );
    const status =
      String(
        message.task.status ??
        'updated',
      );

    return publishAdminNotification({
      level: 'log',
      message:
        'Задача ' +
        taskType +
        ': ' +
        status,
      source: {
        kind:
          'admin-task-state',
        id:
          message.task.id ??
          null,
      },
    });
  }

  if (
    message?.type ===
      'success' &&
    message.update
  ) {
    return publishAdminNotification({
      level: 'info',
      message:
        'Задача ' +
        String(
          message.update.taskType ??
          'admin-task',
        ) +
        ' успешно завершена.',
      source: {
        kind:
          'admin-task-success',
        id:
          message.update.taskId ??
          null,
      },
    });
  }

  return null;
}

function handleNotificationControl(
  notification,
) {
  const action =
    notification?.control
      ?.action;

  if (
    action ===
      'refresh-session'
  ) {
    void Promise.resolve(
      window
        .dtpstatReloadAdminSession
        ?.(),
    ).catch(
      (error) =>
        publishAdminNotification({
          level: 'error',
          message:
            error?.message ??
            'Не удалось обновить административную сессию.',
        }),
    );
    return;
  }

  if (
    action ===
      'logout'
  ) {
    stopAdminRealtime();
    window
      .dtpstatAdminSessionGuard
      ?.redirectToLogin?.();
  }
}

function discussionRefreshDetail(
  message,
) {
  if (
    message?.type ===
      'data-change'
  ) {
    const change =
      message.change ??
      {};
    const resource =
      change.resource;

    if (
      ![
        'geometry-discussions',
        'osm-boundary-discussions',
        'discussion-inbox',
      ].includes(
        resource,
      )
    ) {
      return null;
    }

    const source =
      change.source ??
      {};
    const subjectType =
      resource ===
        'geometry-discussions'
        ? 'geometry'
        : resource ===
            'osm-boundary-discussions'
          ? 'osm-boundary'
          : source.subjectType ??
            null;
    const subjectId =
      Number(
        source.geometryId ??
        source.boundaryId ??
        source.subjectId ??
        change.entityIds?.[0],
      );

    return {
      resource,
      subjectType,
      subjectId:
        Number.isSafeInteger(
          subjectId,
        ) &&
        subjectId > 0
          ? subjectId
          : null,
      action:
        change.action ??
        'updated',
      originClientId:
        change.originClientId ??
        null,
      source:
        'data-change',
    };
  }

  if (
    message?.type ===
      'notification' &&
    message.notification
      ?.source?.kind ===
      'discussion-thread'
  ) {
    const rawId =
      String(
        message.notification
          .source.id ??
        '',
      );
    const separator =
      rawId.indexOf(':');

    if (separator <= 0) {
      return null;
    }

    const subjectType =
      rawId.slice(
        0,
        separator,
      );
    const subjectId =
      Number(
        rawId.slice(
          separator + 1,
        ),
      );

    if (
      ![
        'geometry',
        'osm-boundary',
      ].includes(
        subjectType,
      ) ||
      !Number.isSafeInteger(
        subjectId,
      ) ||
      subjectId <= 0
    ) {
      return null;
    }

    return {
      resource:
        subjectType ===
          'geometry'
          ? 'geometry-discussions'
          : 'osm-boundary-discussions',
      subjectType,
      subjectId,
      action:
        'message-created',
      originClientId:
        null,
      source:
        'notification',
    };
  }

  return null;
}

function emit(message) {
  if (
    message?.type ===
    'snapshot'
  ) {
    lastSnapshot =
      structuredClone(message);
  }

  const notification =
    publishRealtimeNotification(
      message,
    );

  if (notification) {
    handleNotificationControl(
      notification,
    );
  }

  if (
    message?.type ===
      'session-control' &&
    message.action ===
      'logout'
  ) {
    const notification =
      publishAdminNotification({
        level: 'error',
        message:
          'Административная сессия завершена сервером.',
        code:
          message.reason ??
          'session-revoked',
      });
    handleNotificationControl({
      ...notification,
      control: {
        action: 'logout',
      },
    });
  }

  window.dispatchEvent(
    new CustomEvent(
      'dtpstat:realtime',
      {
        detail: message,
      },
    ),
  );

  const discussionRefresh =
    discussionRefreshDetail(
      message,
    );
  if (discussionRefresh) {
    window.dispatchEvent(
      new CustomEvent(
        'dtpstat:discussion-unread-refresh',
        {
          detail:
            discussionRefresh,
        },
      ),
    );
  }

  for (const listener of listeners) {
    try {
      listener(
        structuredClone(message),
      );
    } catch (error) {
      console.error(
        'Realtime client listener failed',
        error,
      );
    }
  }
}

function scheduleReconnect() {
  clearTimeout(
    reconnectTimer,
  );
  reconnectTimer =
    window.setTimeout(
      connect,
      RECONNECT_DELAY_MS,
    );
}

function connect() {
  if (
    !started ||
    socket
  ) {
    return;
  }

  const protocol =
    location.protocol === 'https:'
      ? 'wss:'
      : 'ws:';
  const current =
    new WebSocket(
      `${protocol}//${location.host}/api/admin/ws`,
      'dtpstat-api-v' +
        ADMIN_API_VERSION,
    );
  socket = current;

  current.addEventListener(
    'open',
    () => {
      if (socket !== current) {
        return;
      }
      setConnection(
        'online',
        'WebSocket: подключён',
      );
    },
  );

  current.addEventListener(
    'message',
    (event) => {
      try {
        emit(
          JSON.parse(
            event.data,
          ),
        );
      } catch {
        publishAdminNotification({
          level: 'error',
          message:
            'Получено некорректное WebSocket-событие.',
        });
      }
    },
  );

  current.addEventListener(
    'close',
    () => {
      if (socket !== current) {
        return;
      }
      socket = null;
      setConnection(
        'pending',
        'WebSocket: переподключение…',
      );
      if (started) {
        scheduleReconnect();
      }
    },
  );

  current.addEventListener(
    'error',
    () => {
      current.close();

      void fetch(
        '/api/admin/me',
        {
          credentials:
            'same-origin',
          headers: {
            Accept:
              'application/json',
          },
        },
      ).catch(
        () => {
          // Network failures are handled by the normal reconnect loop.
        },
      );
    },
  );
}

export function startAdminRealtime() {
  if (started) return;
  started = true;
  setConnection(
    'pending',
    'WebSocket: подключение…',
  );
  connect();
}

export function stopAdminRealtime() {
  started = false;
  clearTimeout(
    reconnectTimer,
  );
  reconnectTimer = null;

  const current = socket;
  socket = null;
  current?.close();
}

export function subscribeAdminRealtime(
  listener,
  { replaySnapshot = true } = {},
) {
  if (typeof listener !== 'function') {
    throw new TypeError(
      'Realtime listener must be a function',
    );
  }

  listeners.add(listener);
  startAdminRealtime();

  if (
    replaySnapshot &&
    lastSnapshot
  ) {
    queueMicrotask(
      () => {
        if (
          listeners.has(listener)
        ) {
          listener(
            structuredClone(
              lastSnapshot,
            ),
          );
        }
      },
    );
  }

  return () =>
    listeners.delete(listener);
}

export function adminRealtimeSnapshot() {
  return lastSnapshot
    ? structuredClone(
      lastSnapshot,
    )
    : null;
}
