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
  window.dtpstatAdminSession = loadAdminSession();
}

export { loadAdminSession };
