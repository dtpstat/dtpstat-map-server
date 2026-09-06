const host = document.querySelector('#profile-editor-host');

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.headers ?? {}),
    },
  });
  let payload = null;
  if (response.status !== 204) {
    try { payload = await response.json(); } catch { /* non-json */ }
  }
  if (!response.ok) {
    const error = new Error(payload?.error ?? `HTTP ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function message(element, text, tone = '') {
  element.textContent = text;
  element.className = `profile-message${tone ? ` is-${tone}` : ''}`;
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString('ru-RU') : '—';
}

if (host) {
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = '/admin/profile.css';
  document.head.append(stylesheet);

  host.innerHTML = `
    <div class="profile-grid">
      <section class="profile-panel">
        <h3>Профиль</h3>
        <div class="profile-identity">
          <div class="profile-avatar-wrap">
            <img id="profile-avatar" class="profile-avatar" alt="Аватар" hidden>
            <div id="profile-avatar-fallback" class="profile-avatar profile-avatar-fallback">?</div>
          </div>
          <div>
            <strong id="profile-display-heading">—</strong>
            <div class="profile-muted" id="profile-login-heading">—</div>
          </div>
        </div>
        <form id="profile-account-form" class="profile-form">
          <label>Логин
            <input name="username" type="text" readonly>
          </label>
          <label>Имя
            <input name="displayName" type="text" maxlength="160" required>
          </label>
          <label>Email
            <input name="email" type="email" maxlength="320">
          </label>
          <button type="submit">Сохранить профиль</button>
        </form>
        <div class="profile-avatar-actions">
          <label class="secondary profile-file-button">Загрузить аватар
            <input id="profile-avatar-file" type="file" accept="image/png,image/jpeg,image/webp" hidden>
          </label>
          <button type="button" class="secondary" id="profile-avatar-delete">Удалить аватар</button>
        </div>
        <small class="profile-muted">PNG/JPEG/WebP, до 256 КиБ. SVG не принимается.</small>
        <p id="profile-account-message" class="profile-message" role="status"></p>
      </section>

      <section class="profile-panel">
        <h3>Пароль</h3>
        <div id="profile-password-required" class="profile-warning" hidden>
          Используется временный пароль. До его смены остальные разделы админки недоступны.
        </div>
        <form id="profile-password-form" class="profile-form">
          <label>Текущий пароль
            <input name="currentPassword" type="password" required autocomplete="current-password">
          </label>
          <label>Новый пароль
            <input name="newPassword" type="password" minlength="12" maxlength="1024" required autocomplete="new-password">
          </label>
          <label>Повторите новый пароль
            <input name="repeatPassword" type="password" minlength="12" maxlength="1024" required autocomplete="new-password">
          </label>
          <button type="submit">Сменить пароль</button>
        </form>
        <p id="profile-password-message" class="profile-message" role="status"></p>
      </section>

      <section class="profile-panel profile-sessions-panel">
        <div class="profile-section-heading">
          <div>
            <h3>Активные сессии</h3>
            <p class="profile-muted">IP, браузер и время последней активности.</p>
          </div>
          <button type="button" class="secondary" id="profile-revoke-others">Завершить остальные</button>
        </div>
        <div id="profile-sessions"></div>
        <p id="profile-sessions-message" class="profile-message" role="status"></p>
      </section>
    </div>
  `;

  const accountForm = host.querySelector('#profile-account-form');
  const passwordForm = host.querySelector('#profile-password-form');
  const accountMessage = host.querySelector('#profile-account-message');
  const passwordMessage = host.querySelector('#profile-password-message');
  const sessionsMessage = host.querySelector('#profile-sessions-message');
  const sessionsHost = host.querySelector('#profile-sessions');
  let currentSessionId = null;
  let currentUser = null;

  function updateAvatar(user) {
    const image = host.querySelector('#profile-avatar');
    const fallback = host.querySelector('#profile-avatar-fallback');
    const fallbackText = (user.displayName || user.username || '?').trim().slice(0, 1).toUpperCase();
    fallback.textContent = fallbackText;
    if (user.hasAvatar) {
      image.src = `/api/admin/profile/avatar?v=${Date.now()}`;
      image.hidden = false;
      fallback.hidden = true;
    } else {
      image.removeAttribute('src');
      image.hidden = true;
      fallback.hidden = false;
    }
  }

  function renderUser(user) {
    currentUser = user;
    accountForm.elements.username.value = user.username;
    accountForm.elements.displayName.value = user.displayName ?? user.username;
    accountForm.elements.email.value = user.email ?? '';
    host.querySelector('#profile-display-heading').textContent = user.displayName ?? user.username;
    host.querySelector('#profile-login-heading').textContent = `@${user.username}`;
    host.querySelector('#profile-password-required').hidden = !user.mustChangePassword;
    updateAvatar(user);
  }

  async function loadSession() {
    const session = await globalThis.dtpstatReloadAdminSession?.() ?? await globalThis.dtpstatAdminSession;
    currentSessionId = session.sessionId ?? null;
    renderUser(session.user);
    return session;
  }

  function sessionCard(session) {
    const card = document.createElement('article');
    card.className = 'profile-session';
    const current = session.id === currentSessionId;
    card.innerHTML = `
      <div>
        <strong>${current ? 'Текущая сессия' : 'Сессия'}</strong>
        <div class="profile-muted"></div>
      </div>
      <button type="button" class="secondary">Завершить</button>
    `;
    card.querySelector('.profile-muted').textContent = [
      session.ipAddress ?? 'IP неизвестен',
      `создана ${formatDate(session.createdAt)}`,
      `активность ${formatDate(session.lastSeenAt)}`,
      session.userAgent ?? '',
    ].filter(Boolean).join(' · ');
    const button = card.querySelector('button');
    button.addEventListener('click', async () => {
      if (!window.confirm(current ? 'Завершить текущую сессию и выйти?' : 'Завершить эту сессию?')) return;
      try {
        const result = await api(`/api/admin/profile/sessions/${session.id}`, { method: 'DELETE' });
        if (result.loggedOut) {
          window.location.replace('/admin/login.html');
          return;
        }
        await loadSessions();
      } catch (error) {
        message(sessionsMessage, error.message, 'error');
      }
    });
    return card;
  }

  async function loadSessions() {
    try {
      const payload = await api('/api/admin/profile/sessions');
      currentSessionId = payload.currentSessionId;
      sessionsHost.replaceChildren(...payload.sessions.map(sessionCard));
      message(sessionsMessage, `Активных сессий: ${payload.sessions.length}`);
    } catch (error) {
      message(sessionsMessage, error.message, 'error');
    }
  }

  accountForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!accountForm.reportValidity()) return;
    try {
      const payload = await api('/api/admin/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: accountForm.elements.displayName.value,
          email: accountForm.elements.email.value.trim() || null,
        }),
      });
      renderUser(payload.user);
      await globalThis.dtpstatReloadAdminSession?.();
      message(accountMessage, 'Профиль сохранён.', 'success');
    } catch (error) {
      message(accountMessage, error.message, 'error');
    }
  });

  passwordForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!passwordForm.reportValidity()) return;
    if (passwordForm.elements.newPassword.value !== passwordForm.elements.repeatPassword.value) {
      message(passwordMessage, 'Новый пароль и повтор не совпадают.', 'error');
      return;
    }
    try {
      const payload = await api('/api/admin/profile/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: passwordForm.elements.currentPassword.value,
          newPassword: passwordForm.elements.newPassword.value,
        }),
      });
      passwordForm.reset();
      renderUser(payload.user);
      await globalThis.dtpstatReloadAdminSession?.();
      window.dispatchEvent(new CustomEvent('dtpstat:password-changed'));
      message(passwordMessage, 'Пароль изменён. Остальные сессии завершены.', 'success');
    } catch (error) {
      message(passwordMessage, error.message, 'error');
    }
  });

  host.querySelector('#profile-avatar-file').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const response = await fetch('/api/admin/profile/avatar', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error ?? `HTTP ${response.status}`);
      renderUser(payload.user);
      await globalThis.dtpstatReloadAdminSession?.();
      message(accountMessage, 'Аватар обновлён.', 'success');
    } catch (error) {
      message(accountMessage, error.message, 'error');
    } finally {
      event.target.value = '';
    }
  });

  host.querySelector('#profile-avatar-delete').addEventListener('click', async () => {
    if (!currentUser?.hasAvatar) return;
    try {
      const payload = await api('/api/admin/profile/avatar', { method: 'DELETE' });
      renderUser(payload.user);
      await globalThis.dtpstatReloadAdminSession?.();
      message(accountMessage, 'Аватар удалён.', 'success');
    } catch (error) {
      message(accountMessage, error.message, 'error');
    }
  });

  host.querySelector('#profile-revoke-others').addEventListener('click', async () => {
    if (!window.confirm('Завершить все остальные активные сессии этой учётной записи?')) return;
    try {
      const result = await api('/api/admin/profile/sessions/others', { method: 'DELETE' });
      message(sessionsMessage, `Завершено сессий: ${result.revoked}.`, 'success');
      await loadSessions();
    } catch (error) {
      message(sessionsMessage, error.message, 'error');
    }
  });

  window.addEventListener('dtpstat:admin-session-changed', (event) => renderUser(event.detail.user));
  await loadSession();
  await loadSessions();
}
