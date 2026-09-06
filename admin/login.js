const form = document.querySelector('#admin-login-form');
const message = document.querySelector('#admin-login-message');

async function alreadyAuthenticated() {
  try {
    const response = await fetch('/api/admin/me', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    return response.ok;
  } catch {
    return false;
  }
}

if (await alreadyAuthenticated()) {
  window.location.replace('/admin/');
} else if (form) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    message.textContent = 'Проверяем учётные данные…';
    message.className = 'notice';
    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: form.elements.username.value,
          password: form.elements.password.value,
        }),
      });
      let payload = null;
      try { payload = await response.json(); } catch { /* no body */ }
      if (!response.ok) {
        const retry = payload?.retryAfterSeconds
          ? ` Повторите через ${payload.retryAfterSeconds} сек.`
          : '';
        throw new Error(`${payload?.error ?? `HTTP ${response.status}`}${retry}`);
      }
      window.location.replace('/admin/');
    } catch (error) {
      message.textContent = error.message;
      message.className = 'notice notice-error';
      form.elements.password.value = '';
      form.elements.password.focus();
    } finally {
      button.disabled = false;
    }
  });
}
