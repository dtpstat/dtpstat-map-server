const LOGIN_URL = '/admin/login.html?expired=1';
const SESSION_EXPIRY_HEADER = 'x-dtpstat-admin-session-expires-at';

function requestURL(input, baseHref) {
  try {
    const value = typeof input === 'string' || input instanceof URL
      ? input
      : input?.url;
    return new URL(value, baseHref);
  } catch {
    return null;
  }
}

export function isProtectedAdminRequest(input, baseHref) {
  const url = requestURL(input, baseHref);
  if (!url) return false;
  const base = new URL(baseHref);
  return url.origin === base.origin &&
    url.pathname.startsWith('/api/admin/') &&
    url.pathname !== '/api/admin/login';
}

export function createAdminSessionFetchGuard({
  fetchImpl,
  location,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
  now = () => Date.now(),
  keepAliveIntervalMs = 30_000,
}) {
  let timer = null;
  let keepAliveTimer = null;
  let keepAliveInFlight = false;
  let deadlineMs = null;
  let redirecting = false;
  let activityHeld = false;

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeoutImpl(timer);
      timer = null;
    }
  };

  const clearKeepAlive = () => {
    if (keepAliveTimer !== null) {
      clearIntervalImpl(keepAliveTimer);
      keepAliveTimer = null;
    }
  };

  const redirectToLogin = () => {
    if (redirecting) return;
    redirecting = true;
    clearTimer();
    clearKeepAlive();
    if (!location.pathname.endsWith('/login.html')) {
      location.replace(LOGIN_URL);
    }
  };

  const scheduleExpiry = (expiresAt) => {
    const nextDeadline = Date.parse(expiresAt);
    if (!Number.isFinite(nextDeadline)) return;
    deadlineMs = nextDeadline;
    clearTimer();
    if (activityHeld) return;

    const schedule = () => {
      const remaining = deadlineMs - now();
      if (remaining <= 0) {
        redirectToLogin();
        return;
      }
      timer = setTimeoutImpl(
        schedule,
        Math.min(remaining, 2_000_000_000),
      );
    };
    schedule();
  };

  const guardedFetch = async (input, init) => {
    const response = await fetchImpl(input, init);
    if (!isProtectedAdminRequest(input, location.href)) return response;

    if (response.status === 401) {
      redirectToLogin();
      return response;
    }

    const expiresAt = response.headers?.get?.(SESSION_EXPIRY_HEADER);
    if (response.ok && expiresAt) scheduleExpiry(expiresAt);
    return response;
  };

  const keepAlive = async () => {
    if (!activityHeld || keepAliveInFlight || redirecting) return;
    keepAliveInFlight = true;
    try {
      await guardedFetch('/api/admin/me', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
    } catch {
      // A transient network failure must not abort the running server task.
      // The next keepalive interval or any successful admin request will retry.
    } finally {
      keepAliveInFlight = false;
    }
  };

  const setActivityHold = (active) => {
    const next = Boolean(active);
    if (next === activityHeld) return activityHeld;
    activityHeld = next;

    if (activityHeld) {
      clearTimer();
      void keepAlive();
      clearKeepAlive();
      keepAliveTimer = setIntervalImpl(() => {
        void keepAlive();
      }, keepAliveIntervalMs);
      return true;
    }

    clearKeepAlive();
    if (deadlineMs !== null) {
      scheduleExpiry(new Date(deadlineMs).toISOString());
    }
    return false;
  };

  return {
    fetch: guardedFetch,
    redirectToLogin,
    scheduleExpiry,
    setActivityHold,
    isActivityHeld: () => activityHeld,
    stop() {
      clearTimer();
      clearKeepAlive();
      activityHeld = false;
      deadlineMs = null;
    },
  };
}

async function loadAdminSession() {
  const response = await fetch('/api/admin/me', {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  let payload = null;
  try { payload = await response.json(); } catch { /* keep HTTP status below */ }
  if (!response.ok) {
    const error = new Error(payload?.error ?? `HTTP ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

if (typeof window !== 'undefined') {
  const nativeFetch = globalThis.fetch.bind(globalThis);
  const guard = createAdminSessionFetchGuard({
    fetchImpl: nativeFetch,
    location: window.location,
  });
  globalThis.fetch = guard.fetch;
  window.dtpstatAdminSessionGuard = guard;

  window.dtpstatAdminSession = loadAdminSession()
    .then((session) => {
      if (session.expiresAt) guard.scheduleExpiry(session.expiresAt);
      return session;
    })
    .catch((error) => {
      if (error.status === 401) guard.redirectToLogin();
      throw error;
    });

  window.dtpstatReloadAdminSession = async () => {
    const session = await loadAdminSession();
    if (session.expiresAt) guard.scheduleExpiry(session.expiresAt);
    window.dtpstatAdminSession = Promise.resolve(session);
    window.dispatchEvent(new CustomEvent(
      'dtpstat:admin-session-changed',
      { detail: session },
    ));
    return session;
  };
}

export { loadAdminSession };
