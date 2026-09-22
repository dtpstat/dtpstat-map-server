const CHANNEL_NAME = 'dtpstat-derived-data';
const STORAGE_KEY = 'dtpstat:derived-data-change';
const LOCAL_EVENT = 'dtpstat:derived-data-change';

function payload(reason) {
  return {
    id: globalThis.crypto?.randomUUID?.() ??
      `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    reason: String(reason || 'unknown'),
    at: new Date().toISOString(),
  };
}

export function publishDerivedDataChange(reason) {
  if (typeof window === 'undefined') return null;
  const message = payload(reason);

  window.dispatchEvent(new CustomEvent(LOCAL_EVENT, {
    detail: message,
  }));

  if (typeof BroadcastChannel === 'function') {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    try {
      channel.postMessage(message);
    } finally {
      channel.close();
    }
    return message;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(message));
  } catch {
    // Cross-tab refresh is best-effort. The saving request has already
    // completed and the next normal API reload still sees fresh data.
  }
  return message;
}

export function subscribeDerivedDataChanges(handler) {
  if (typeof window === 'undefined') return () => {};

  const onLocal = (event) => handler(event.detail);
  window.addEventListener(LOCAL_EVENT, onLocal);

  if (typeof BroadcastChannel === 'function') {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.addEventListener('message', (event) => handler(event.data));
    return () => {
      window.removeEventListener(LOCAL_EVENT, onLocal);
      channel.close();
    };
  }

  const onStorage = (event) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try {
      handler(JSON.parse(event.newValue));
    } catch {
      // Ignore malformed values written by unrelated/old clients.
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(LOCAL_EVENT, onLocal);
    window.removeEventListener('storage', onStorage);
  };
}
