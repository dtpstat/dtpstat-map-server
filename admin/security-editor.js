const stylesheet = document.createElement('link');
stylesheet.rel = 'stylesheet';
stylesheet.href = '/admin/security.css';
document.head.append(stylesheet);

const host = document.querySelector('#security-editor-host');

if (host) {
  host.innerHTML = `
    <nav class="security-tabs" role="tablist" aria-label="Безопасность">
      <button type="button" role="tab" aria-selected="true"
              data-security-tab="users" aria-controls="security-panel-users">Пользователи</button>
      <button type="button" role="tab" aria-selected="false"
              data-security-tab="audit" aria-controls="security-panel-audit">Аудит</button>
      <button type="button" role="tab" aria-selected="false"
              data-security-tab="settings" aria-controls="security-panel-settings">Защита входа</button>
      <button type="button" role="tab" aria-selected="false"
              data-security-tab="transfer" aria-controls="security-panel-transfer">Настройки проекта</button>
    </nav>

    <section class="security-panel" id="security-panel-users" data-security-panel="users">
      <div class="security-section-heading">
        <div>
          <h3>Пользователи</h3>
          <p>Права независимы: управление данными, настройка интерфейса либо оба сразу.</p>
        </div>
        <button type="button" class="secondary" id="security-refresh-users">Обновить</button>
      </div>

      <form id="security-create-user" class="security-create-user">
        <h4>Новый пользователь</h4>
        <div class="security-user-grid">
          <label>Логин
            <input name="username" type="text" maxlength="64" required autocomplete="off">
          </label>
          <label>Email
            <input name="email" type="email" maxlength="320" autocomplete="off">
          </label>
          <label>Пароль
            <input name="password" type="password" minlength="12" maxlength="1024" required autocomplete="new-password">
          </label>
          <label class="check"><input name="canManageData" type="checkbox"> Импорт / экспорт</label>
          <label class="check"><input name="canManageInterface" type="checkbox"> Настройка интерфейса</label>
        </div>
        <button type="submit">Добавить пользователя</button>
      </form>

      <div id="security-users-list" class="security-users-list"></div>
      <p id="security-users-message" class="security-message" role="status"></p>
    </section>

    <section class="security-panel" id="security-panel-audit" data-security-panel="audit" hidden>
      <div class="security-section-heading">
        <div>
          <h3>Аудит административных операций</h3>
          <p>Входы, ошибки входа, блокировки и операции с данными/настройками.</p>
        </div>
        <button type="button" class="secondary" id="security-refresh-audit">Обновить</button>
      </div>
      <div class="security-audit-table-wrap">
        <table class="security-audit-table">
          <thead>
            <tr>
              <th>Время</th>
              <th>Пользователь</th>
              <th>IP</th>
              <th>Операция</th>
              <th>Статус</th>
              <th>Время, мс</th>
              <th>Детали</th>
            </tr>
          </thead>
          <tbody id="security-audit-body"></tbody>
        </table>
      </div>
      <p id="security-audit-message" class="security-message" role="status"></p>
    </section>

    <section class="security-panel" id="security-panel-settings" data-security-panel="settings" hidden>
      <h3>Защита от перебора паролей</h3>
      <p class="panel-description">Неудачные попытки считаются для конкретной учётной записи внутри заданного окна. При достижении порога учётка временно блокируется.</p>
      <form id="security-settings-form" class="security-settings-form">
        <label>Неудачных попыток до блокировки
          <input name="maxFailedAttempts" type="number" min="1" max="100" step="1" required>
        </label>
        <label>Окно подсчёта попыток, сек.
          <input name="failureWindowSeconds" type="number" min="10" max="86400" step="1" required>
        </label>
        <label>Время временной блокировки, сек.
          <input name="lockoutSeconds" type="number" min="10" max="604800" step="1" required>
        </label>
        <button type="submit">Сохранить параметры защиты</button>
      </form>
      <p id="security-settings-message" class="security-message" role="status"></p>
    </section>

    <section class="security-panel" id="security-panel-transfer" data-security-panel="transfer" hidden>
      <h3>Экспорт / импорт всех настроек проекта</h3>
      <p class="panel-description">Переносит оформление проекта, типы линий, расчётные метрики/таблицу/CSV/рейтинг и параметры защиты входа. Пользователи, пароли, журнал аудита, данные городов/линий/населения и инфраструктурные ENV-секреты в файл не входят.</p>
      <div class="security-transfer-actions">
        <a class="secondary-link" href="/api/admin/settings/export" download="project-settings.json">
          Выгрузить настройки JSON
        </a>
        <form id="security-settings-import-form" class="security-transfer-form">
          <label>Файл настроек проекта
            <input name="file" type="file" accept=".json,application/json" required>
          </label>
          <p class="security-transfer-warning">Импорт заменяет PROJECT_SETTINGS, REPORT_CONFIG и параметры защиты входа; типы линий сопоставляются по NAME, их оформление обновляется, отсутствующие NAME создаются с новым локальным CODE. Лишние типы целевой БД не удаляются.</p>
          <button type="submit">Импортировать настройки</button>
        </form>
      </div>
      <p id="security-transfer-message" class="security-message" role="status"></p>
    </section>
  `;

  const tabs = [...host.querySelectorAll('[data-security-tab]')];
  const panels = [...host.querySelectorAll('[data-security-panel]')];
  const usersList = host.querySelector('#security-users-list');
  const usersMessage = host.querySelector('#security-users-message');
  const auditBody = host.querySelector('#security-audit-body');
  const auditMessage = host.querySelector('#security-audit-message');
  const settingsMessage = host.querySelector('#security-settings-message');
  const transferMessage = host.querySelector('#security-transfer-message');
  const createUserForm = host.querySelector('#security-create-user');
  const settingsForm = host.querySelector('#security-settings-form');
  const settingsImportForm = host.querySelector('#security-settings-import-form');

  function selectTab(key) {
    for (const tab of tabs) {
      const active = tab.dataset.securityTab === key;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    }
    for (const panel of panels) panel.hidden = panel.dataset.securityPanel !== key;
    if (key === 'audit') void loadAudit();
    if (key === 'settings') void loadSettings();
  }

  for (const tab of tabs) {
    tab.addEventListener('click', () => selectTab(tab.dataset.securityTab));
  }

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
    try { payload = await response.json(); } catch { /* no body */ }
    if (!response.ok) throw new Error(payload?.error ?? `HTTP ${response.status}`);
    return payload;
  }

  function setMessage(element, text, tone = '') {
    element.textContent = text;
    element.className = `security-message${tone ? ` is-${tone}` : ''}`;
  }

  function userCard(user) {
    const card = document.createElement('article');
    card.className = 'security-user-card';
    card.dataset.userId = String(user.id);
    card.innerHTML = `
      <div class="security-user-heading">
        <div>
          <strong></strong>
          <span class="security-user-badge"></span>
        </div>
        <span class="security-user-last-login"></span>
      </div>
      <form class="security-user-form">
        <div class="security-user-grid">
          <label>Email
            <input name="email" type="email" maxlength="320">
          </label>
          <label class="check"><input name="canManageData" type="checkbox"> Импорт / экспорт</label>
          <label class="check"><input name="canManageInterface" type="checkbox"> Настройка интерфейса</label>
          <label class="check"><input name="isBlocked" type="checkbox"> Заблокирован вручную</label>
        </div>
        <button type="submit">Сохранить пользователя</button>
      </form>
      <form class="security-password-form">
        <label>Новый пароль
          <input name="password" type="password" minlength="12" maxlength="1024" required autocomplete="new-password">
        </label>
        <button type="submit" class="secondary">Сменить пароль</button>
      </form>
    `;

    card.querySelector('.security-user-heading strong').textContent = user.username;
    const badge = card.querySelector('.security-user-badge');
    badge.textContent = user.isBootstrap
      ? 'BOOTSTRAP SUPERUSER'
      : user.isSuperuser ? 'SUPERUSER' : 'USER';
    badge.classList.toggle('is-superuser', user.isSuperuser);
    badge.classList.toggle('is-bootstrap', user.isBootstrap);
    if (user.isBootstrap) {
      badge.title = 'Первоначальная учётная запись: удаление, ручная блокировка и отзыв прав запрещены. Временная блокировка от перебора сохраняется.';
    }
    const lastLogin = card.querySelector('.security-user-last-login');
    lastLogin.textContent = user.lastLoginAt
      ? `Вход: ${new Date(user.lastLoginAt).toLocaleString('ru-RU')}`
      : 'Входов ещё не было';

    const form = card.querySelector('.security-user-form');
    form.elements.email.value = user.email ?? '';
    form.elements.canManageData.checked = Boolean(user.canManageData);
    form.elements.canManageInterface.checked = Boolean(user.canManageInterface);
    form.elements.isBlocked.checked = Boolean(user.isBlocked);
    if (user.isSuperuser || user.isBootstrap) {
      form.elements.canManageData.checked = true;
      form.elements.canManageInterface.checked = true;
      form.elements.canManageData.disabled = true;
      form.elements.canManageInterface.disabled = true;
      form.elements.isBlocked.checked = false;
      form.elements.isBlocked.disabled = true;
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      setMessage(usersMessage, `Сохраняем ${user.username}…`);
      try {
        await api(`/api/admin/security/users/${user.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: form.elements.email.value.trim() || null,
            canManageData: form.elements.canManageData.checked,
            canManageInterface: form.elements.canManageInterface.checked,
            isBlocked: form.elements.isBlocked.checked,
          }),
        });
        setMessage(usersMessage, `Пользователь ${user.username} сохранён.`, 'success');
        await loadUsers();
      } catch (error) {
        setMessage(usersMessage, error.message, 'error');
      }
    });

    const passwordForm = card.querySelector('.security-password-form');
    passwordForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!passwordForm.reportValidity()) return;
      setMessage(usersMessage, `Меняем пароль ${user.username}…`);
      try {
        await api(`/api/admin/security/users/${user.id}/password`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: passwordForm.elements.password.value }),
        });
        passwordForm.reset();
        setMessage(usersMessage, `Пароль ${user.username} изменён.`, 'success');
      } catch (error) {
        setMessage(usersMessage, error.message, 'error');
      }
    });

    return card;
  }

  async function loadUsers() {
    setMessage(usersMessage, 'Загружаем пользователей…');
    try {
      const payload = await api('/api/admin/security/users');
      usersList.replaceChildren(...payload.users.map(userCard));
      setMessage(usersMessage, `Пользователей: ${payload.users.length}`);
    } catch (error) {
      setMessage(usersMessage, error.message, 'error');
    }
  }

  createUserForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!createUserForm.reportValidity()) return;
    const data = new FormData(createUserForm);
    setMessage(usersMessage, 'Создаём пользователя…');
    try {
      await api('/api/admin/security/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: String(data.get('username')).trim(),
          email: String(data.get('email')).trim() || null,
          password: String(data.get('password')),
          canManageData: data.get('canManageData') === 'on',
          canManageInterface: data.get('canManageInterface') === 'on',
        }),
      });
      createUserForm.reset();
      setMessage(usersMessage, 'Пользователь добавлен.', 'success');
      await loadUsers();
    } catch (error) {
      setMessage(usersMessage, error.message, 'error');
    }
  });

  function auditRow(entry) {
    const row = document.createElement('tr');
    const values = [
      new Date(entry.createdAt).toLocaleString('ru-RU'),
      entry.username ?? '—',
      entry.ipAddress ?? '—',
      entry.operationType,
      entry.status,
      entry.durationMs ?? '—',
    ];
    for (const value of values) {
      const cell = document.createElement('td');
      cell.textContent = String(value);
      row.append(cell);
    }
    const detailsCell = document.createElement('td');
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    const pre = document.createElement('pre');
    summary.textContent = entry.eventType;
    pre.textContent = JSON.stringify(entry.details ?? {}, null, 2);
    details.append(summary, pre);
    detailsCell.append(details);
    row.append(detailsCell);
    return row;
  }

  async function loadAudit() {
    setMessage(auditMessage, 'Загружаем аудит…');
    try {
      const payload = await api('/api/admin/security/audit?limit=200');
      auditBody.replaceChildren(...payload.entries.map(auditRow));
      setMessage(auditMessage, `Показано записей: ${payload.entries.length}`);
    } catch (error) {
      setMessage(auditMessage, error.message, 'error');
    }
  }

  async function loadSettings() {
    setMessage(settingsMessage, 'Загружаем параметры…');
    try {
      const payload = await api('/api/admin/security/settings');
      settingsForm.elements.maxFailedAttempts.value = payload.settings.maxFailedAttempts;
      settingsForm.elements.failureWindowSeconds.value = payload.settings.failureWindowSeconds;
      settingsForm.elements.lockoutSeconds.value = payload.settings.lockoutSeconds;
      setMessage(settingsMessage, 'Параметры загружены.');
    } catch (error) {
      setMessage(settingsMessage, error.message, 'error');
    }
  }

  settingsForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!settingsForm.reportValidity()) return;
    setMessage(settingsMessage, 'Сохраняем параметры…');
    try {
      const payload = await api('/api/admin/security/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          maxFailedAttempts: Number(settingsForm.elements.maxFailedAttempts.value),
          failureWindowSeconds: Number(settingsForm.elements.failureWindowSeconds.value),
          lockoutSeconds: Number(settingsForm.elements.lockoutSeconds.value),
        }),
      });
      settingsForm.elements.maxFailedAttempts.value = payload.settings.maxFailedAttempts;
      settingsForm.elements.failureWindowSeconds.value = payload.settings.failureWindowSeconds;
      settingsForm.elements.lockoutSeconds.value = payload.settings.lockoutSeconds;
      setMessage(settingsMessage, 'Параметры защиты сохранены.', 'success');
    } catch (error) {
      setMessage(settingsMessage, error.message, 'error');
    }
  });

  settingsImportForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!settingsImportForm.reportValidity()) return;
    const file = new FormData(settingsImportForm).get('file');
    if (!(file instanceof File) || file.size === 0) return;
    setMessage(transferMessage, 'Проверяем и импортируем настройки…');
    const submit = settingsImportForm.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      let payload;
      try {
        payload = JSON.parse(await file.text());
      } catch {
        throw new Error('Файл не содержит корректный JSON');
      }
      const result = await api('/api/admin/settings/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      settingsImportForm.reset();
      const imported = result.imported ?? {};
      setMessage(
        transferMessage,
        `Настройки импортированы: проект «${imported.projectName ?? '—'}», типов ${imported.lineTypes ?? 0}, метрик ${imported.metrics ?? 0}, пересчитано городов ${imported.materializedCities ?? 0}.`,
        'success',
      );
      await Promise.all([loadUsers(), loadSettings(), loadAudit()]);
    } catch (error) {
      setMessage(transferMessage, error.message, 'error');
    } finally {
      submit.disabled = false;
    }
  });

  host.querySelector('#security-refresh-users').addEventListener('click', () => void loadUsers());
  host.querySelector('#security-refresh-audit').addEventListener('click', () => void loadAudit());
  window.addEventListener('dtpstat:security-refresh', () => {
    void loadUsers();
    void loadAudit();
  });

  void Promise.all([loadUsers(), loadSettings()]);
}
