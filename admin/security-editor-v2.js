const session = await globalThis.dtpstatAdminSession?.catch(() => null);
const currentUser = session?.user;
const host = document.querySelector('#security-editor-host');

const canManageUsers = Boolean(currentUser?.isSuperuser || currentUser?.canManageUsers);
const canViewAudit = Boolean(currentUser?.isSuperuser || currentUser?.canViewAudit);
const canManageSecurity = Boolean(currentUser?.isSuperuser || currentUser?.canManageSecurity);

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: { Accept: 'application/json', ...(options.headers ?? {}) },
  });
  let payload = null;
  if (response.status !== 204) {
    try { payload = await response.json(); } catch { /* no body */ }
  }
  if (!response.ok) throw new Error(payload?.error ?? `HTTP ${response.status}`);
  return payload;
}

function setMessage(element, text, tone = '') {
  if (!element) return;
  element.textContent = text;
  element.className = `security-message${tone ? ` is-${tone}` : ''}`;
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString('ru-RU') : '—';
}

function durationOptions(includeIndefinite = true) {
  return `
    <option value="900">15 минут</option>
    <option value="3600" selected>1 час</option>
    <option value="86400">24 часа</option>
    <option value="604800">7 дней</option>
    ${includeIndefinite ? '<option value="0">Бессрочно</option>' : ''}
  `;
}

if (host && (canManageUsers || canViewAudit || canManageSecurity)) {
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = '/admin/security-v2.css';
  document.head.append(stylesheet);

  const visibleTabs = [
    canManageUsers ? ['users', 'Пользователи'] : null,
    canViewAudit ? ['audit', 'Аудит'] : null,
    canManageSecurity ? ['security', 'Защита'] : null,
  ].filter(Boolean);

  host.innerHTML = `
    <nav class="security-tabs" role="tablist" aria-label="Безопасность">
      ${visibleTabs.map(([key, title], index) => `
        <button type="button" role="tab" data-security-tab="${key}"
                aria-selected="${index === 0}" aria-controls="security-panel-${key}">${title}</button>
      `).join('')}
    </nav>
    ${canManageUsers ? `
      <section class="security-panel" id="security-panel-users" data-security-panel="users">
        <div class="security-master-detail">
          <aside class="security-users-master">
            <div class="security-master-toolbar">
              <input id="security-user-search" type="search" placeholder="Поиск пользователя…" aria-label="Поиск пользователя">
              <button type="button" id="security-user-add">Добавить</button>
            </div>
            <div id="security-users-list" class="security-users-list" role="listbox"></div>
          </aside>
          <section class="security-user-detail" id="security-user-detail">
            <p class="empty-state">Выберите пользователя слева.</p>
          </section>
        </div>
        <p id="security-users-message" class="security-message" role="status"></p>
      </section>
    ` : ''}
    ${canViewAudit ? `
      <section class="security-panel" id="security-panel-audit" data-security-panel="audit" hidden>
        <div class="security-section-heading">
          <div><h3>Аудит</h3><p>Входы и административные операции с фильтрацией и быстрыми реакциями.</p></div>
          <a class="secondary-link" id="security-audit-export" href="/api/admin/security/audit/export.csv" download>Экспорт CSV</a>
        </div>
        <form id="security-audit-filter" class="security-audit-filter">
          <label>От <input name="from" type="datetime-local"></label>
          <label>До <input name="to" type="datetime-local"></label>
          <label>Тип события <select name="eventType"><option value="">Все</option></select></label>
          <label>Операция <select name="operationType"><option value="">Все</option></select></label>
          <label>Статус <select name="status"><option value="">Все</option></select></label>
          <label>Пользователь <input name="username" type="text"></label>
          <label>IP <input name="ipAddress" type="text"></label>
          <div class="security-filter-actions">
            <button type="submit">Применить</button>
            <button type="button" class="secondary" id="security-audit-reset">Сбросить</button>
          </div>
        </form>
        <div class="security-audit-table-wrap">
          <table class="security-audit-table">
            <thead><tr>
              <th>Время</th><th>Пользователь</th><th>IP</th><th>Событие</th>
              <th>Операция</th><th>Статус</th><th>мс</th><th>Реакция</th><th>Детали</th>
            </tr></thead>
            <tbody id="security-audit-body"></tbody>
          </table>
        </div>
        <div class="security-pagination">
          <button type="button" class="secondary" id="security-audit-prev">← Назад</button>
          <span id="security-audit-page">1</span>
          <button type="button" class="secondary" id="security-audit-next">Вперёд →</button>
        </div>
        <p id="security-audit-message" class="security-message" role="status"></p>
      </section>
    ` : ''}
    ${canManageSecurity ? `
      <section class="security-panel" id="security-panel-security" data-security-panel="security" hidden>
        <div class="security-settings-grid">
          <form id="security-settings-form" class="security-settings-form">
            <h3>Защита входа и сессии</h3>
            <fieldset><legend>Учётная запись</legend>
              <label>Попыток до блокировки <input name="maxFailedAttempts" type="number" min="1" max="100" required></label>
              <label>Окно попыток, сек. <input name="failureWindowSeconds" type="number" min="10" max="86400" required></label>
              <label>Блокировка, сек. <input name="lockoutSeconds" type="number" min="10" max="604800" required></label>
            </fieldset>
            <fieldset><legend>IP</legend>
              <label>Попыток до IP lockout <input name="ipMaxFailedAttempts" type="number" min="1" max="1000" required></label>
              <label>Окно IP, сек. <input name="ipFailureWindowSeconds" type="number" min="10" max="86400" required></label>
              <label>IP lockout, сек. <input name="ipLockoutSeconds" type="number" min="10" max="604800" required></label>
            </fieldset>
            <fieldset><legend>Сессии и аудит</legend>
              <label>Idle timeout, сек. <input name="sessionIdleSeconds" type="number" min="60" max="86400" required></label>
              <label>Максимальная жизнь сессии, сек. <input name="sessionAbsoluteSeconds" type="number" min="300" max="2592000" required></label>
              <label>Хранить аудит, дней (0 = бессрочно) <input name="auditRetentionDays" type="number" min="0" max="3650" required></label>
            </fieldset>
            <button type="submit">Сохранить параметры</button>
            <p id="security-settings-message" class="security-message" role="status"></p>
          </form>

          <section class="security-ip-panel">
            <h3>Ручные блокировки IP</h3>
            <form id="security-ip-block-form" class="security-ip-block-form">
              <label>IP <input name="ipAddress" type="text" required placeholder="203.0.113.10"></label>
              <label>Срок <select name="durationSeconds">${durationOptions()}</select></label>
              <label>Причина <input name="reason" type="text" maxlength="500"></label>
              <button type="submit">Заблокировать IP</button>
            </form>
            <div id="security-ip-blocks" class="security-ip-blocks"></div>
            <p id="security-ip-message" class="security-message" role="status"></p>
          </section>
        </div>
      </section>
    ` : ''}
    <div id="security-secret-overlay" class="security-secret-overlay" hidden></div>
  `;

  const tabs = [...host.querySelectorAll('[data-security-tab]')];
  const panels = [...host.querySelectorAll('[data-security-panel]')];
  const userById = new Map();
  let selectedUserId = null;
  let auditOffset = 0;
  const auditLimit = 100;
  let secretTimer = null;

  function selectTab(key) {
    for (const tab of tabs) {
      const active = tab.dataset.securityTab === key;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    }
    for (const panel of panels) panel.hidden = panel.dataset.securityPanel !== key;
    if (key === 'audit') void loadAudit();
    if (key === 'security') void Promise.all([loadSettings(), loadIpBlocks()]);
  }
  for (const tab of tabs) tab.addEventListener('click', () => selectTab(tab.dataset.securityTab));
  selectTab(tabs[0]?.dataset.securityTab);

  function showTemporaryPassword(password, username) {
    const overlay = host.querySelector('#security-secret-overlay');
    if (secretTimer) clearTimeout(secretTimer);
    overlay.hidden = false;
    overlay.innerHTML = `
      <div class="security-secret-card" role="dialog" aria-modal="true" aria-label="Временный пароль">
        <h3>Временный пароль для ${username}</h3>
        <p>Пароль показывается только сейчас и в открытом виде не сохраняется.</p>
        <code class="security-secret-value"></code>
        <div class="security-secret-actions">
          <button type="button" id="security-secret-copy">Копировать</button>
          <button type="button" class="secondary" id="security-secret-close">Закрыть</button>
        </div>
        <small>Пользователь обязан сменить этот пароль после первого входа. Значение будет удалено с экрана автоматически через 5 минут.</small>
      </div>
    `;
    overlay.querySelector('.security-secret-value').textContent = password;
    const close = () => {
      overlay.querySelector('.security-secret-value').textContent = '';
      overlay.replaceChildren();
      overlay.hidden = true;
      if (secretTimer) clearTimeout(secretTimer);
      secretTimer = null;
    };
    overlay.querySelector('#security-secret-copy').addEventListener('click', async () => {
      await navigator.clipboard.writeText(password);
      overlay.querySelector('#security-secret-copy').textContent = 'Скопировано';
    });
    overlay.querySelector('#security-secret-close').addEventListener('click', close);
    secretTimer = setTimeout(close, 5 * 60 * 1000);
  }

  function roleCheckbox(name, label, checked, disabled) {
    return `<label class="check"><input name="${name}" type="checkbox" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}> ${label}</label>`;
  }

  function renderDetail(user) {
    selectedUserId = user?.id ?? null;
    const detail = host.querySelector('#security-user-detail');
    if (!user) {
      detail.innerHTML = '<p class="empty-state">Выберите пользователя слева.</p>';
      return;
    }
    const protectedUser = user.isBootstrap || user.isSuperuser;
    const isSelf = user.id === currentUser.id;
    detail.innerHTML = `
      <div class="security-user-detail-heading">
        <div><h3>${user.displayName || user.username}</h3><p>@${user.username}</p></div>
        <div class="security-user-badges">
          ${user.isBootstrap ? '<span>BOOTSTRAP</span>' : ''}
          ${user.isSuperuser ? '<span>SUPERUSER</span>' : ''}
          ${user.mustChangePassword ? '<span class="is-warning">TEMP PASSWORD</span>' : ''}
          ${user.isBlocked ? '<span class="is-danger">BLOCKED</span>' : ''}
        </div>
      </div>
      <form id="security-user-detail-form" class="security-detail-form">
        <fieldset>
          <legend>Учётные данные</legend>
          <div class="security-detail-fields">
            <label>Логин <input name="username" value="${user.username}" readonly></label>
            <label>Имя <input name="displayName" maxlength="160" required></label>
            <label>Email <input name="email" type="email" maxlength="320"></label>
            <label>Последний вход <input value="${formatDate(user.lastLoginAt)}" readonly></label>
            <label>Создан <input value="${formatDate(user.createdAt)}" readonly></label>
          </div>
        </fieldset>
        <fieldset>
          <legend>Роли</legend>
          <div class="security-role-grid">
            ${roleCheckbox('canManageData', 'Управление данными', user.canManageData, protectedUser)}
            ${roleCheckbox('canManageInterface', 'Настройка интерфейса', user.canManageInterface, protectedUser)}
            ${roleCheckbox('canManageUsers', 'Управление пользователями', user.canManageUsers, protectedUser)}
            ${roleCheckbox('canViewAudit', 'Просмотр аудита', user.canViewAudit, protectedUser)}
            ${roleCheckbox('canManageSecurity', 'Управление безопасностью', user.canManageSecurity, protectedUser)}
          </div>
          ${protectedUser ? '<small>Для bootstrap/superuser права зафиксированы и не могут быть отозваны.</small>' : ''}
        </fieldset>
        <button type="submit">Сохранить пользователя</button>
      </form>
      <section class="security-access-section">
        <h4>Доступ</h4>
        <div class="security-access-actions">
          <button type="button" class="secondary" id="security-temp-password">Создать временный пароль</button>
          ${user.isBlocked
            ? '<button type="button" id="security-user-unblock">Разблокировать</button>'
            : `<button type="button" class="secondary" id="security-user-block" ${protectedUser || isSelf ? 'disabled' : ''}>Заблокировать</button>`}
          <button type="button" class="danger" id="security-user-delete" ${user.isBootstrap || isSelf ? 'disabled' : ''}>Удалить</button>
        </div>
        ${!user.isBlocked && !protectedUser && !isSelf ? `
          <form id="security-user-block-form" class="security-inline-block-form" hidden>
            <label>Срок <select name="durationSeconds">${durationOptions()}</select></label>
            <label>Причина <input name="reason" maxlength="500"></label>
            <button type="submit">Подтвердить блокировку</button>
          </form>
        ` : ''}
        ${user.manualBlockReason ? `<p class="security-block-reason">Причина: ${user.manualBlockReason}</p>` : ''}
      </section>
    `;
    const form = detail.querySelector('#security-user-detail-form');
    form.elements.displayName.value = user.displayName ?? user.username;
    form.elements.email.value = user.email ?? '';
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      try {
        const payload = await api(`/api/admin/security/users/${user.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            displayName: form.elements.displayName.value,
            email: form.elements.email.value.trim() || null,
            canManageData: form.elements.canManageData.checked,
            canManageInterface: form.elements.canManageInterface.checked,
            canManageUsers: form.elements.canManageUsers.checked,
            canViewAudit: form.elements.canViewAudit.checked,
            canManageSecurity: form.elements.canManageSecurity.checked,
          }),
        });
        userById.set(user.id, payload.user);
        setMessage(host.querySelector('#security-users-message'), 'Пользователь сохранён.', 'success');
        await loadUsers(user.id);
      } catch (error) {
        setMessage(host.querySelector('#security-users-message'), error.message, 'error');
      }
    });

    detail.querySelector('#security-temp-password').addEventListener('click', async () => {
      if (!window.confirm(`Сбросить пароль ${user.username}, завершить его сессии и выдать временный пароль?`)) return;
      try {
        const payload = await api(`/api/admin/security/users/${user.id}/temporary-password`, { method: 'POST' });
        showTemporaryPassword(payload.temporaryPassword, user.username);
        await loadUsers(user.id);
      } catch (error) {
        setMessage(host.querySelector('#security-users-message'), error.message, 'error');
      }
    });

    const blockButton = detail.querySelector('#security-user-block');
    const blockForm = detail.querySelector('#security-user-block-form');
    blockButton?.addEventListener('click', () => { blockForm.hidden = !blockForm.hidden; });
    blockForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await api(`/api/admin/security/users/${user.id}/block`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            durationSeconds: Number(blockForm.elements.durationSeconds.value),
            reason: blockForm.elements.reason.value.trim() || null,
          }),
        });
        await loadUsers(user.id);
      } catch (error) {
        setMessage(host.querySelector('#security-users-message'), error.message, 'error');
      }
    });
    detail.querySelector('#security-user-unblock')?.addEventListener('click', async () => {
      try {
        await api(`/api/admin/security/users/${user.id}/unblock`, { method: 'POST' });
        await loadUsers(user.id);
      } catch (error) {
        setMessage(host.querySelector('#security-users-message'), error.message, 'error');
      }
    });
    detail.querySelector('#security-user-delete').addEventListener('click', async () => {
      if (!window.confirm(`Удалить пользователя ${user.username}? Это действие необратимо.`)) return;
      try {
        await api(`/api/admin/security/users/${user.id}`, { method: 'DELETE' });
        selectedUserId = null;
        await loadUsers();
      } catch (error) {
        setMessage(host.querySelector('#security-users-message'), error.message, 'error');
      }
    });
  }

  function renderNewUser() {
    const detail = host.querySelector('#security-user-detail');
    selectedUserId = null;
    detail.innerHTML = `
      <h3>Новый пользователь</h3>
      <form id="security-new-user-form" class="security-detail-form">
        <fieldset><legend>Учётные данные</legend>
          <div class="security-detail-fields">
            <label>Логин <input name="username" maxlength="64" required autocomplete="off"></label>
            <label>Имя <input name="displayName" maxlength="160"></label>
            <label>Email <input name="email" type="email" maxlength="320"></label>
          </div>
        </fieldset>
        <fieldset><legend>Роли</legend>
          <div class="security-role-grid">
            ${roleCheckbox('canManageData', 'Управление данными', false, false)}
            ${roleCheckbox('canManageInterface', 'Настройка интерфейса', false, false)}
            ${roleCheckbox('canManageUsers', 'Управление пользователями', false, false)}
            ${roleCheckbox('canViewAudit', 'Просмотр аудита', false, false)}
            ${roleCheckbox('canManageSecurity', 'Управление безопасностью', false, false)}
          </div>
        </fieldset>
        <p class="security-info">Пароль генерирует сервер. После создания он будет показан один раз и должен быть изменён пользователем при первом входе.</p>
        <button type="submit">Создать пользователя</button>
      </form>
    `;
    const form = detail.querySelector('#security-new-user-form');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      try {
        const payload = await api('/api/admin/security/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: form.elements.username.value,
            displayName: form.elements.displayName.value.trim() || null,
            email: form.elements.email.value.trim() || null,
            canManageData: form.elements.canManageData.checked,
            canManageInterface: form.elements.canManageInterface.checked,
            canManageUsers: form.elements.canManageUsers.checked,
            canViewAudit: form.elements.canViewAudit.checked,
            canManageSecurity: form.elements.canManageSecurity.checked,
          }),
        });
        showTemporaryPassword(payload.temporaryPassword, payload.user.username);
        await loadUsers(payload.user.id);
      } catch (error) {
        setMessage(host.querySelector('#security-users-message'), error.message, 'error');
      }
    });
  }

  function userListRow(user) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'security-user-row';
    button.dataset.userId = String(user.id);
    button.setAttribute('role', 'option');
    const state = user.isBlocked ? 'BLOCKED' : user.mustChangePassword ? 'TEMP' : 'ACTIVE';
    button.innerHTML = `
      <span class="security-user-row-main"><strong></strong><small></small></span>
      <span class="security-user-row-state is-${state.toLowerCase()}">${state}</span>
    `;
    button.querySelector('strong').textContent = user.displayName ?? user.username;
    button.querySelector('small').textContent = `@${user.username}${user.email ? ` · ${user.email}` : ''}`;
    button.classList.toggle('is-selected', user.id === selectedUserId);
    button.addEventListener('click', () => {
      selectedUserId = user.id;
      renderUsersList();
      renderDetail(user);
    });
    return button;
  }

  function renderUsersList() {
    const query = host.querySelector('#security-user-search')?.value.trim().toLocaleLowerCase('ru-RU') ?? '';
    const users = [...userById.values()].filter((user) => {
      if (!query) return true;
      return [user.username, user.displayName, user.email]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase('ru-RU').includes(query));
    });
    host.querySelector('#security-users-list')?.replaceChildren(...users.map(userListRow));
  }

  async function loadUsers(selectId = selectedUserId) {
    if (!canManageUsers) return;
    const message = host.querySelector('#security-users-message');
    setMessage(message, 'Загружаем пользователей…');
    try {
      const payload = await api('/api/admin/security/users');
      userById.clear();
      for (const user of payload.users) userById.set(user.id, user);
      selectedUserId = selectId && userById.has(selectId)
        ? selectId
        : payload.users[0]?.id ?? null;
      renderUsersList();
      renderDetail(selectedUserId ? userById.get(selectedUserId) : null);
      setMessage(message, `Пользователей: ${payload.users.length}`);
    } catch (error) {
      setMessage(message, error.message, 'error');
    }
  }

  host.querySelector('#security-user-search')?.addEventListener('input', renderUsersList);
  host.querySelector('#security-user-add')?.addEventListener('click', renderNewUser);

  function auditQuery({ exportMode = false } = {}) {
    const form = host.querySelector('#security-audit-filter');
    const data = new FormData(form);
    const params = new URLSearchParams();
    for (const key of ['from','to','eventType','operationType','status','username','ipAddress']) {
      const value = String(data.get(key) ?? '').trim();
      if (value) params.set(key, value);
    }
    params.set('limit', String(exportMode ? 5000 : auditLimit));
    params.set('offset', String(exportMode ? 0 : auditOffset));
    return params;
  }

  async function quickBlockUser(entry) {
    if (!canManageUsers || !entry.userId) return;
    const target = userById.get(entry.userId);
    if (target?.isBootstrap) {
      window.alert('Bootstrap-администратор не может быть заблокирован вручную.');
      return;
    }
    if (!window.confirm(`Заблокировать ${entry.username ?? `user #${entry.userId}`} на 1 час?`)) return;
    await api(`/api/admin/security/users/${entry.userId}/block`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        durationSeconds: 3600,
        reason: `Быстрая реакция из аудита #${entry.id}`,
      }),
    });
    if (canManageUsers) await loadUsers(selectedUserId);
  }

  async function quickBlockIp(entry) {
    if (!canManageSecurity || !entry.ipAddress) return;
    if (!window.confirm(`Заблокировать IP ${entry.ipAddress} на 1 час?`)) return;
    await api('/api/admin/security/ip-blocks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ipAddress: entry.ipAddress,
        durationSeconds: 3600,
        reason: `Быстрая реакция из аудита #${entry.id}`,
        sourceAuditId: entry.id,
      }),
    });
  }

  function auditRow(entry) {
    const row = document.createElement('tr');
    for (const value of [
      formatDate(entry.createdAt), entry.username ?? '—', entry.ipAddress ?? '—',
      entry.eventType, entry.operationType, entry.status, entry.durationMs ?? '—',
    ]) {
      const cell = document.createElement('td');
      cell.textContent = String(value);
      row.append(cell);
    }
    const actions = document.createElement('td');
    actions.className = 'security-audit-actions';
    if (canManageUsers && entry.userId) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'mini-button';
      button.textContent = 'Блок. учётку';
      button.addEventListener('click', () => void quickBlockUser(entry).then(loadAudit).catch((error) => setMessage(host.querySelector('#security-audit-message'), error.message, 'error')));
      actions.append(button);
    }
    if (canManageSecurity && entry.ipAddress) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'mini-button';
      button.textContent = 'Блок. IP';
      button.addEventListener('click', () => void quickBlockIp(entry).then(loadAudit).catch((error) => setMessage(host.querySelector('#security-audit-message'), error.message, 'error')));
      actions.append(button);
    }
    if (!actions.childElementCount) actions.textContent = '—';
    row.append(actions);
    const detailsCell = document.createElement('td');
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    const pre = document.createElement('pre');
    const changeCount = Array.isArray(entry.details?.changes)
      ? entry.details.changes.length
      : 0;
    summary.textContent = changeCount ? `Изменения (${changeCount})` : 'JSON';
    pre.textContent = JSON.stringify(entry.details ?? {}, null, 2);
    details.append(summary, pre);
    detailsCell.append(details);
    row.append(detailsCell);
    return row;
  }

  async function loadAudit() {
    if (!canViewAudit) return;
    const message = host.querySelector('#security-audit-message');
    try {
      const params = auditQuery();
      const payload = await api(`/api/admin/security/audit?${params}`);
      host.querySelector('#security-audit-body').replaceChildren(...payload.entries.map(auditRow));
      host.querySelector('#security-audit-page').textContent = String(Math.floor(auditOffset / auditLimit) + 1);
      host.querySelector('#security-audit-prev').disabled = auditOffset === 0;
      host.querySelector('#security-audit-next').disabled = payload.entries.length < auditLimit;
      host.querySelector('#security-audit-export').href = `/api/admin/security/audit/export.csv?${auditQuery({ exportMode: true })}`;
      setMessage(message, `Показано записей: ${payload.entries.length}`);
    } catch (error) {
      setMessage(message, error.message, 'error');
    }
  }

  async function loadAuditFacets() {
    if (!canViewAudit) return;
    try {
      const facets = await api('/api/admin/security/audit/facets');
      const form = host.querySelector('#security-audit-filter');
      for (const [name, values] of [
        ['eventType', facets.eventTypes],
        ['operationType', facets.operationTypes],
        ['status', facets.statuses],
      ]) {
        const select = form.elements[name];
        for (const value of values) {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = value;
          select.append(option);
        }
      }
    } catch { /* filters still work as text-free all-values selectors */ }
  }

  host.querySelector('#security-audit-filter')?.addEventListener('submit', (event) => {
    event.preventDefault();
    auditOffset = 0;
    void loadAudit();
  });
  host.querySelector('#security-audit-reset')?.addEventListener('click', () => {
    host.querySelector('#security-audit-filter').reset();
    auditOffset = 0;
    void loadAudit();
  });
  host.querySelector('#security-audit-prev')?.addEventListener('click', () => {
    auditOffset = Math.max(0, auditOffset - auditLimit);
    void loadAudit();
  });
  host.querySelector('#security-audit-next')?.addEventListener('click', () => {
    auditOffset += auditLimit;
    void loadAudit();
  });

  async function loadSettings() {
    if (!canManageSecurity) return;
    const form = host.querySelector('#security-settings-form');
    const message = host.querySelector('#security-settings-message');
    try {
      const payload = await api('/api/admin/security/settings');
      for (const [key, value] of Object.entries(payload.settings)) {
        if (form.elements[key]) form.elements[key].value = value;
      }
      setMessage(message, 'Параметры загружены.');
    } catch (error) {
      setMessage(message, error.message, 'error');
    }
  }

  host.querySelector('#security-settings-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const keys = [
      'maxFailedAttempts','failureWindowSeconds','lockoutSeconds',
      'ipMaxFailedAttempts','ipFailureWindowSeconds','ipLockoutSeconds',
      'sessionIdleSeconds','sessionAbsoluteSeconds','auditRetentionDays',
    ];
    try {
      await api('/api/admin/security/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(keys.map((key) => [key, Number(form.elements[key].value)]))),
      });
      setMessage(host.querySelector('#security-settings-message'), 'Параметры сохранены.', 'success');
    } catch (error) {
      setMessage(host.querySelector('#security-settings-message'), error.message, 'error');
    }
  });

  function ipBlockCard(block) {
    const row = document.createElement('article');
    row.className = 'security-ip-block-row';
    row.innerHTML = `
      <div><strong></strong><div class="security-muted"></div></div>
      <button type="button" class="secondary">Разблокировать</button>
    `;
    row.querySelector('strong').textContent = block.ipAddress;
    row.querySelector('.security-muted').textContent = [
      block.expiresAt ? `до ${formatDate(block.expiresAt)}` : 'бессрочно',
      block.reason ?? '',
    ].filter(Boolean).join(' · ');
    row.querySelector('button').addEventListener('click', async () => {
      try {
        await api(`/api/admin/security/ip-blocks/${block.id}`, { method: 'DELETE' });
        await loadIpBlocks();
      } catch (error) {
        setMessage(host.querySelector('#security-ip-message'), error.message, 'error');
      }
    });
    return row;
  }

  async function loadIpBlocks() {
    if (!canManageSecurity) return;
    try {
      const payload = await api('/api/admin/security/ip-blocks');
      host.querySelector('#security-ip-blocks').replaceChildren(...payload.blocks.map(ipBlockCard));
      setMessage(host.querySelector('#security-ip-message'), `Активных блокировок: ${payload.blocks.length}`);
    } catch (error) {
      setMessage(host.querySelector('#security-ip-message'), error.message, 'error');
    }
  }

  host.querySelector('#security-ip-block-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    try {
      await api('/api/admin/security/ip-blocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ipAddress: form.elements.ipAddress.value.trim(),
          durationSeconds: Number(form.elements.durationSeconds.value),
          reason: form.elements.reason.value.trim() || null,
        }),
      });
      form.reset();
      await loadIpBlocks();
    } catch (error) {
      setMessage(host.querySelector('#security-ip-message'), error.message, 'error');
    }
  });

  if (canManageUsers) await loadUsers();
  if (canViewAudit) await loadAuditFacets();
  window.addEventListener('dtpstat:security-refresh', () => {
    if (canManageUsers) void loadUsers(selectedUserId);
    if (canViewAudit) void loadAudit();
    if (canManageSecurity) void loadIpBlocks();
  });
}
