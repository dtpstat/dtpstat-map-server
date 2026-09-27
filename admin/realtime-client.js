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

function feedback(
  text,
  tone = 'info',
  timeoutMs = 6000,
) {
  const show =
    window
      .dtpstatAdminFeedback;
  if (
    typeof show === 'function'
  ) {
    show(
      text,
      tone,
      timeoutMs,
    );
  }
}

function emit(message) {
  if (
    message?.type ===
    'snapshot'
  ) {
    lastSnapshot =
      structuredClone(message);
  }

  if (
    message?.type ===
      'data-change' &&
    message.change
      ?.originClientId !==
      realtimeClientId() &&
    message.change
      ?.message
  ) {
    feedback(
      message.change.message,
      'info',
    );
  }

  window.dispatchEvent(
    new CustomEvent(
      'dtpstat:realtime',
      {
        detail: message,
      },
    ),
  );

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
        feedback(
          'Получено некорректное WebSocket-событие.',
          'error',
        );
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
    () => current.close(),
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
