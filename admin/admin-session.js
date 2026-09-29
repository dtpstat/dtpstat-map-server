import {
  ADMIN_API_VERSION,
  ADMIN_API_VERSION_HEADER,
} from './api-contract-client.js';

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

export function isAdminApiRequest(
  input,
  baseHref,
) {
  const url =
    requestURL(
      input,
      baseHref,
    );
  if (!url) return false;

  const base =
    new URL(baseHref);

  return (
    url.origin ===
      base.origin &&
    url.pathname
      .startsWith(
        '/api/admin/',
      )
  );
}

export function isProtectedAdminRequest(
  input,
  baseHref,
) {
  if (
    !isAdminApiRequest(
      input,
      baseHref,
    )
  ) {
    return false;
  }

  const url =
    requestURL(
      input,
      baseHref,
    );

  return ![
    '/api/admin/login',
    '/api/admin/login/mfa',
  ].includes(
    url.pathname,
  );
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
  onVersionMismatch = () => {},
}) {
  let timer = null;
  let keepAliveTimer = null;
  let keepAliveInFlight = false;
  let deadlineMs = null;
  let redirecting = false;
  let activityHeld = false;
  let versionStale = false;

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

  const guardedFetch = async (
    input,
    init = {},
  ) => {
    const adminRequest =
      isAdminApiRequest(
        input,
        location.href,
      );

    if (
      adminRequest &&
      versionStale
    ) {
      const error =
        new Error(
          'Administrative client is out of date; reload the page',
        );
      error.code =
        'api_client_reload_required';
      throw error;
    }

    let requestInit = init;

    if (adminRequest) {
      const headers =
        new Headers(
          (
            input instanceof Request
              ? input.headers
              : undefined
          ),
        );

      new Headers(
        init.headers ??
        {},
      ).forEach(
        (value, name) => {
          headers.set(
            name,
            value,
          );
        },
      );

      headers.set(
        ADMIN_API_VERSION_HEADER,
        ADMIN_API_VERSION,
      );

      requestInit = {
        ...init,
        headers,
      };
    }

    const response =
      await fetchImpl(
        input,
        requestInit,
      );

    if (
      adminRequest &&
      response.status === 426
    ) {
      versionStale = true;
      onVersionMismatch({
        requiredVersion:
          response.headers
            ?.get?.(
              'x-dtpstat-api-version-required',
            ) ??
          null,
      });
      return response;
    }

    if (
      !isProtectedAdminRequest(
        input,
        location.href,
      )
    ) {
      return response;
    }

    if (
      response.status === 401
    ) {
      redirectToLogin();
      return response;
    }

    const expiresAt =
      response.headers
        ?.get?.(
          SESSION_EXPIRY_HEADER,
        );
    if (
      response.ok &&
      expiresAt
    ) {
      scheduleExpiry(
        expiresAt,
      );
    }
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
    isVersionStale:
      () => versionStale,
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

function showVersionReloadBlock() {
  if (
    document.getElementById(
      'dtpstat-api-version-block',
    )
  ) {
    return;
  }

  const overlay =
    document.createElement(
      'div',
    );
  overlay.id =
    'dtpstat-api-version-block';
  overlay.setAttribute(
    'role',
    'alertdialog',
  );
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:2147483647;' +
    'display:grid;place-items:center;background:rgba(0,0,0,.78);padding:24px';

  const box =
    document.createElement(
      'div',
    );
  box.style.cssText =
    'max-width:560px;background:#fff;color:#111;padding:24px;border-radius:10px;' +
    'box-shadow:0 12px 40px rgba(0,0,0,.35);font:16px/1.45 system-ui,sans-serif';

  const title =
    document.createElement('h2');
  title.textContent =
    'Админ-клиент устарел';

  const text =
    document.createElement('p');
  text.textContent =
    'Сервер обновлён. Перезагрузите страницу перед продолжением работы. ' +
    'Локальные изменения геометрий сохранены в localStorage.';

  const button =
    document.createElement(
      'button',
    );
  button.type =
    'button';
  button.textContent =
    'Перезагрузить страницу';
  button.addEventListener(
    'click',
    () =>
      window.location.reload(),
  );

  box.append(
    title,
    text,
    button,
  );
  overlay.append(box);
  document.body.append(
    overlay,
  );
}

if (typeof window !== 'undefined') {
  const nativeFetch = globalThis.fetch.bind(globalThis);
  const guard = createAdminSessionFetchGuard({
    fetchImpl: nativeFetch,
    location: window.location,
    onVersionMismatch:
      showVersionReloadBlock,
  });
  globalThis.fetch = guard.fetch;
  window.dtpstatAdminSessionGuard = guard;

  document.addEventListener(
    'click',
    (event) => {
      const anchor =
        event.target
          ?.closest?.(
            'a[download]',
          );

      if (
        !anchor ||
        !isAdminApiRequest(
          anchor.href,
          window.location.href,
        )
      ) {
        return;
      }

      event.preventDefault();

      void (async () => {
        const response =
          await guard.fetch(
            anchor.href,
            {
              credentials:
                'same-origin',
              headers: {
                Accept:
                  '*/*',
              },
            },
          );

        if (!response.ok) {
          if (
            response.status ===
            426
          ) {
            return;
          }

          throw new Error(
            'HTTP ' +
            response.status,
          );
        }

        const blob =
          await response.blob();
        const objectURL =
          URL.createObjectURL(
            blob,
          );
        const download =
          document.createElement(
            'a',
          );

        download.href =
          objectURL;
        download.download =
          anchor.getAttribute(
            'download',
          ) ||
          '';
        download.hidden =
          true;
        document.body.append(
          download,
        );
        download.click();
        download.remove();
        window.setTimeout(
          () =>
            URL.revokeObjectURL(
              objectURL,
            ),
          0,
        );
      })().catch(
        (error) => {
          console.error(
            'Admin download failed',
            error,
          );
          window
            .dtpstatAdminFeedback?.(
              'Не удалось скачать файл.',
              'error',
            );
        },
      );
    },
    true,
  );

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
