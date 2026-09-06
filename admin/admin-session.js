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

function redirectToLogin() {
  if (!window.location.pathname.endsWith('/login.html')) {
    window.location.replace('/admin/login.html');
  }
}

if (typeof window !== 'undefined') {
  window.dtpstatAdminSession = loadAdminSession().catch((error) => {
    if (error.status === 401 || error.status === 403 || error.status === 423 || error.status === 429) {
      redirectToLogin();
    }
    throw error;
  });
  window.dtpstatReloadAdminSession = async () => {
    const session = await loadAdminSession();
    window.dtpstatAdminSession = Promise.resolve(session);
    window.dispatchEvent(new CustomEvent('dtpstat:admin-session-changed', { detail: session }));
    return session;
  };
}

export { loadAdminSession };
