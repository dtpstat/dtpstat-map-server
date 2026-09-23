import { adminAlert, adminConfirm } from './admin-dialog.js';
import { trackDirtyForm } from './admin-dirty-state.js';
import { bindHumanUnits } from './admin-human-units.js';
import { readTabState, writeTabState } from './admin-tab-state.js';

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
        <details class="security-audit-filter-panel">
          <summary>Фильтры аудита</summary>
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
        </details>
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
            <fieldset><legend>Политика паролей</legend>
              <div class="security-password-lengths">
                <label>Минимум символов
                  <input name="passwordMinLength" type="number" min="1" max="4096" required>
                </label>
                <input name="passwordMaxLength" type="hidden">
              </div>
              <div class="security-password-requirements">
                <label class="check"><input name="passwordRequireLowercase" type="checkbox"> Строчная буква</label>
                <label class="check"><input name="passwordRequireUppercase" type="checkbox"> Прописная буква</label>
                <label class="check"><input name="passwordRequireDigit" type="checkbox"> Цифра</label>
                <label class="check"><input name="passwordRequireSpecial" type="checkbox"> Спецсимвол</label>
              </div>
              <p class="security-info">Эти требования видит пользователь при смене временного или обычного пароля.</p>
            </fieldset>

            <details class="admin-advanced-settings">
              <summary>Тонкая настройка блокировок, сессий и аудита</summary>
              <div class="admin-advanced-settings-body">
                <p class="admin-advanced-settings-note">Эти параметры обычно меняет технический администратор. Рядом с секундами показывается привычное время.</p>
                <fieldset><legend>Учётная запись</legend>
                  <label>Попыток до блокировки <input name="maxFailedAttempts" type="number" min="1" max="100" required></label>
                  <label>Окно попыток, сек. <input name="failureWindowSeconds" type="number" min="10" max="86400" required data-human-unit="seconds"></label>
                  <label>Блокировка, сек. <input name="lockoutSeconds" type="number" min="10" max="604800" required data-human-unit="seconds"></label>
                </fieldset>
                <fieldset><legend>IP</legend>
                  <label>Попыток до IP lockout <input name="ipMaxFailedAttempts" type="number" min="1" max="1000" required></label>
                  <label>Окно IP, сек. <input name="ipFailureWindowSeconds" type="number" min="10" max="86400" required data-human-unit="seconds"></label>
                  <label>IP lockout, сек. <input name="ipLockoutSeconds" type="number" min="10" max="604800" required data-human-unit="seconds"></label>
                </fieldset>
                <fieldset><legend>Сессии и аудит</legend>
                  <label>Idle timeout, сек. <input name="sessionIdleSeconds" type="number" min="60" max="86400" required data-human-unit="seconds"></label>
                  <label>Максимальная жизнь сессии, сек. <input name="sessionAbsoluteSeconds" type="number" min="300" max="2592000" required data-human-unit="seconds"></label>
                  <label>Хранить аудит, дней (0 = бессрочно) <input name="auditRetentionDays" type="number" min="0" max="3650" required data-human-unit="days"></label>
                </fieldset>
              </div>
            </details>
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
    <div id="security-audit-detail-overlay" class="security-audit-detail-overlay" hidden>
      <section class="security-audit-detail-dialog"
               role="dialog"
               aria-modal="true"
               aria-labelledby="security-audit-detail-title">
        <header class="security-audit-detail-header">
          <div>
            <p class="security-audit-detail-eyebrow">ДЕТАЛИ АУДИТА</p>
            <h3 id="security-audit-detail-title">—</h3>
            <p id="security-audit-detail-meta" class="security-muted"></p>
          </div>
          <button type="button"
                  class="secondary security-audit-detail-close"
                  aria-label="Закрыть">×</button>
        </header>
        <div class="security-audit-detail-toolbar">
          <button type="button" class="secondary" data-audit-view="tree"
                  aria-pressed="true">Tree</button>
          <button type="button" class="secondary" data-audit-view="raw"
                  aria-pressed="false">Raw</button>
          <span class="security-audit-detail-toolbar-spacer"></span>
          <button type="button" class="secondary" id="security-audit-expand-all">
            Развернуть всё
          </button>
          <button type="button" class="secondary" id="security-audit-collapse-all">
            Свернуть всё
          </button>
          <button type="button" id="security-audit-copy-json">Копировать JSON</button>
        </div>
        <div class="security-audit-detail-body">
          <div id="security-audit-json-tree" class="security-json-tree"></div>
          <pre id="security-audit-json-raw" class="security-json-raw" hidden></pre>
        </div>
      </section>
    </div>
  `;

  const tabs = [...host.querySelectorAll('[data-security-tab]')];
  const panels = [...host.querySelectorAll('[data-security-panel]')];
  const securitySettingsForm = host.querySelector('#security-settings-form');
  const securitySettingsDirty = trackDirtyForm(
    securitySettingsForm,
    { label: 'Параметры безопасности' },
  );
  bindHumanUnits(host);
  const userById = new Map();
  const loadedAvatarUrls = new Set();

  function applyAvatarBackground(avatar, fallback, url) {
    avatar.style.backgroundImage = `url("${url}")`;
    if (loadedAvatarUrls.has(url)) {
      avatar.classList.add('is-image-loaded');
      return;
    }
    const loader = new Image();
    loader.decoding = 'async';
    loader.addEventListener('load', () => {
      loadedAvatarUrls.add(url);
      avatar.classList.add('is-image-loaded');
    }, { once: true });
    loader.addEventListener('error', () => {
      avatar.style.removeProperty('background-image');
      avatar.classList.remove('is-image-loaded');
      fallback.hidden = false;
    }, { once: true });
    loader.src = url;
  }

  let selectedUserId = null;
  let auditOffset = 0;
  const auditLimit = 100;
  let secretTimer = null;
  let auditDetailEntry = null;
  let auditDetailMode = 'tree';
  const jsonBranchRenderers = new WeakMap();

  function selectTab(key) {
    writeTabState('security', key);
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
  const securityTabKeys = tabs.map((tab) => tab.dataset.securityTab);
  selectTab(readTabState('security', securityTabKeys, securityTabKeys[0]));

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
            ${roleCheckbox('canEditOsm', 'Объекты OSM', user.canEditOsm, protectedUser)}
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
            canEditOsm: form.elements.canEditOsm.checked,
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
      const confirmed = await adminConfirm({
        title: 'Выдать временный пароль?',
        message: `Пароль пользователя ${user.username} будет сброшен, а его активные сессии завершены.`,
        confirmLabel: 'Сбросить пароль',
        cancelLabel: 'Отмена',
        destructive: true,
      });
      if (!confirmed) return;
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
      const confirmed = await adminConfirm({
        title: 'Удалить пользователя?',
        message: `Пользователь ${user.username} будет удалён. Это действие необратимо.`,
        confirmLabel: 'Удалить пользователя',
        cancelLabel: 'Отмена',
        destructive: true,
      });
      if (!confirmed) return;
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
            ${roleCheckbox('canEditOsm', 'Объекты OSM', false, false)}
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
            canEditOsm: form.elements.canEditOsm.checked,
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
      <span class="security-user-avatar" aria-hidden="true">
        <span class="security-user-avatar-fallback"></span>
      </span>
      <span class="security-user-row-main"><strong></strong><small></small></span>
      <span class="security-user-row-state is-${state.toLowerCase()}">${state}</span>
    `;
    const avatar = button.querySelector('.security-user-avatar');
    const fallback = button.querySelector('.security-user-avatar-fallback');
    fallback.textContent = auditAvatarFallback(user.displayName ?? user.username);
    if (user.hasAvatar) {
      const avatarVersion = encodeURIComponent(user.updatedAt ?? '1');
      const avatarUrl =
        `/api/admin/security/users/${encodeURIComponent(user.id)}/avatar?v=${avatarVersion}`;
      applyAvatarBackground(avatar, fallback, avatarUrl);
    }
    button.querySelector('strong').textContent = user.displayName ?? user.username;
    button.querySelector('small').textContent = `@${user.username}${user.email ? ` · ${user.email}` : ''}`;
    button.classList.toggle('is-selected', user.id === selectedUserId);
    button.addEventListener('click', () => {
      selectedUserId = user.id;
      for (const row of host.querySelectorAll('.security-user-row')) {
        row.classList.toggle('is-selected', row.dataset.userId === String(user.id));
      }
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

  function auditAvatarFallback(value) {
    return String(value || '?').trim().slice(0, 1).toLocaleUpperCase('ru-RU') || '?';
  }

  function auditUserCell(entry) {
    const cell = document.createElement('td');
    const identity = document.createElement('span');
    identity.className = 'security-audit-user';

    const avatar = document.createElement('span');
    avatar.className = 'security-audit-avatar';

    const fallback = document.createElement('span');
    fallback.className = 'security-audit-avatar-fallback';
    fallback.textContent = auditAvatarFallback(entry.username);
    avatar.append(fallback);

    if (entry.userId) {
      const currentUserRow =
        String(entry.userId) === String(currentUser?.id ?? '');
      const avatarUrl = currentUserRow
        ? '/api/admin/profile/avatar'
        : `/api/admin/security/users/${encodeURIComponent(entry.userId)}/avatar`;
      applyAvatarBackground(avatar, fallback, avatarUrl);
    }

    const name = document.createElement('span');
    name.textContent = entry.username ?? '—';
    identity.append(avatar, name);
    cell.append(identity);
    return cell;
  }

  function jsonPrimitive(value) {
    const span = document.createElement('span');
    if (value === null) {
      span.className = 'security-json-null';
      span.textContent = 'null';
      return span;
    }
    if (typeof value === 'string') {
      span.className = 'security-json-string';
      span.textContent = JSON.stringify(value);
      return span;
    }
    if (typeof value === 'number') {
      span.className = 'security-json-number';
      span.textContent = String(value);
      return span;
    }
    if (typeof value === 'boolean') {
      span.className = 'security-json-boolean';
      span.textContent = String(value);
      return span;
    }
    span.className = 'security-json-string';
    span.textContent = JSON.stringify(String(value));
    return span;
  }

  function appendJsonKey(hostElement, key) {
    if (key === null || key === undefined) return;
    const keyNode = document.createElement('span');
    keyNode.className = 'security-json-key';
    keyNode.textContent = JSON.stringify(String(key));
    hostElement.append(keyNode, document.createTextNode(': '));
  }

  function ensureJsonBranch(details) {
    const render = jsonBranchRenderers.get(details);
    if (!render) return;
    jsonBranchRenderers.delete(details);
    render();
  }

  function jsonTreeNode(key, value) {
    const complex = value !== null && typeof value === 'object';
    if (!complex) {
      const line = document.createElement('div');
      line.className = 'security-json-line';
      appendJsonKey(line, key);
      line.append(jsonPrimitive(value));
      return line;
    }

    const array = Array.isArray(value);
    const keys = array ? value.map((_item, index) => index) : Object.keys(value);
    const details = document.createElement('details');
    details.className = 'security-json-branch';

    const summary = document.createElement('summary');
    appendJsonKey(summary, key);
    const shape = document.createElement('span');
    shape.className = 'security-json-shape';
    shape.textContent = array
      ? `Array [${keys.length}]`
      : `Object {${keys.length}}`;
    summary.append(shape);

    const children = document.createElement('div');
    children.className = 'security-json-children';
    details.append(summary, children);

    jsonBranchRenderers.set(details, () => {
      const fragment = document.createDocumentFragment();
      for (const childKey of keys) {
        fragment.append(jsonTreeNode(childKey, value[childKey]));
      }
      children.append(fragment);
    });
    details.addEventListener('toggle', () => {
      if (details.open) ensureJsonBranch(details);
    });
    return details;
  }

  function renderAuditJsonTree(value) {
    const tree = host.querySelector('#security-audit-json-tree');
    tree.replaceChildren();
    const root = jsonTreeNode(null, value);
    tree.append(root);
    if (root instanceof HTMLDetailsElement) {
      root.open = true;
      ensureJsonBranch(root);
    }
  }

  function setAuditDetailMode(mode) {
    auditDetailMode = mode === 'raw' ? 'raw' : 'tree';
    const tree = host.querySelector('#security-audit-json-tree');
    const raw = host.querySelector('#security-audit-json-raw');
    tree.hidden = auditDetailMode !== 'tree';
    raw.hidden = auditDetailMode !== 'raw';
    for (const button of host.querySelectorAll('[data-audit-view]')) {
      button.setAttribute(
        'aria-pressed',
        String(button.dataset.auditView === auditDetailMode),
      );
    }
    host.querySelector('#security-audit-expand-all').disabled =
      auditDetailMode !== 'tree';
    host.querySelector('#security-audit-collapse-all').disabled =
      auditDetailMode !== 'tree';
  }

  function closeAuditDetails() {
    const overlay = host.querySelector('#security-audit-detail-overlay');
    overlay.hidden = true;
    document.body.classList.remove('security-modal-open');
    host.querySelector('#security-audit-json-tree').replaceChildren();
    host.querySelector('#security-audit-json-raw').textContent = '';
    auditDetailEntry = null;
  }

  function openAuditDetails(entry) {
    auditDetailEntry = entry;
    const overlay = host.querySelector('#security-audit-detail-overlay');
    const title = host.querySelector('#security-audit-detail-title');
    const meta = host.querySelector('#security-audit-detail-meta');
    const raw = host.querySelector('#security-audit-json-raw');
    const details = entry.details ?? {};

    title.textContent = entry.operationType || entry.eventType || `Аудит #${entry.id}`;
    meta.textContent = [
      `#${entry.id}`,
      formatDate(entry.createdAt),
      entry.username ?? 'без пользователя',
      entry.ipAddress ?? null,
      entry.status ?? null,
    ].filter(Boolean).join(' · ');
    raw.textContent = JSON.stringify(details, null, 2);
    renderAuditJsonTree(details);
    setAuditDetailMode('tree');
    overlay.hidden = false;
    document.body.classList.add('security-modal-open');
    overlay.querySelector('.security-audit-detail-close')?.focus();
  }

  function expandAuditJsonTree() {
    const tree = host.querySelector('#security-audit-json-tree');
    const queue = [...tree.querySelectorAll('details.security-json-branch')];
    for (let index = 0; index < queue.length; index += 1) {
      const details = queue[index];
      ensureJsonBranch(details);
      details.open = true;
      const children = details.querySelector(':scope > .security-json-children');
      if (children) {
        queue.push(
          ...children.querySelectorAll(':scope > details.security-json-branch'),
        );
      }
    }
  }

  function collapseAuditJsonTree() {
    for (const details of host.querySelectorAll(
      '#security-audit-json-tree details.security-json-branch',
    )) {
      details.open = false;
    }
  }

  async function copyAuditJson() {
    if (!auditDetailEntry) return;
    const button = host.querySelector('#security-audit-copy-json');
    await navigator.clipboard.writeText(
      JSON.stringify(auditDetailEntry.details ?? {}, null, 2),
    );
    const previous = button.textContent;
    button.textContent = 'Скопировано';
    setTimeout(() => {
      button.textContent = previous;
    }, 1200);
  }

  async function quickBlockUser(entry) {
    if (!canManageUsers || !entry.userId) return;
    const target = userById.get(entry.userId);
    if (target?.isBootstrap) {
      await adminAlert({
        title: 'Блокировка недоступна',
        message: 'Bootstrap-администратор не может быть заблокирован вручную.',
      });
      return;
    }
    const confirmed = await adminConfirm({
      title: 'Заблокировать учётную запись?',
      message: `${entry.username ?? `user #${entry.userId}`} будет заблокирован на 1 час.`,
      confirmLabel: 'Заблокировать',
      cancelLabel: 'Отмена',
      destructive: true,
    });
    if (!confirmed) return;
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
    const confirmed = await adminConfirm({
      title: 'Заблокировать IP?',
      message: `IP ${entry.ipAddress} будет заблокирован на 1 час.`,
      confirmLabel: 'Заблокировать IP',
      cancelLabel: 'Отмена',
      destructive: true,
    });
    if (!confirmed) return;
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

    const time = document.createElement('td');
    time.textContent = formatDate(entry.createdAt);
    row.append(time, auditUserCell(entry));

    for (const value of [
      entry.ipAddress ?? '—',
      entry.eventType,
      entry.operationType,
      entry.status,
      entry.durationMs ?? '—',
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
      button.addEventListener('click', () => void quickBlockUser(entry)
        .then(loadAudit)
        .catch((error) => setMessage(
          host.querySelector('#security-audit-message'),
          error.message,
          'error',
        )));
      actions.append(button);
    }
    if (canManageSecurity && entry.ipAddress) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'mini-button';
      button.textContent = 'Блок. IP';
      button.addEventListener('click', () => void quickBlockIp(entry)
        .then(loadAudit)
        .catch((error) => setMessage(
          host.querySelector('#security-audit-message'),
          error.message,
          'error',
        )));
      actions.append(button);
    }
    if (!actions.childElementCount) actions.textContent = '—';
    row.append(actions);

    const detailsCell = document.createElement('td');
    const changeCount = Array.isArray(entry.details?.changes)
      ? entry.details.changes.length
      : 0;
    const taskLogCount = Array.isArray(entry.details?.taskLog)
      ? entry.details.taskLog.length
      : 0;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary mini-button security-audit-details-open';
    button.textContent = [
      changeCount ? `Изменения (${changeCount})` : null,
      taskLogCount ? `Журнал (${taskLogCount})` : null,
    ].filter(Boolean).join(' · ') || 'Детали';
    button.addEventListener('click', () => openAuditDetails(entry));
    detailsCell.append(button);
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

  const auditOverlay = host.querySelector('#security-audit-detail-overlay');
  auditOverlay?.querySelector('.security-audit-detail-close')
    ?.addEventListener('click', closeAuditDetails);
  auditOverlay?.addEventListener('click', (event) => {
    if (event.target === auditOverlay) closeAuditDetails();
  });
  host.querySelector('#security-audit-expand-all')
    ?.addEventListener('click', expandAuditJsonTree);
  host.querySelector('#security-audit-collapse-all')
    ?.addEventListener('click', collapseAuditJsonTree);
  host.querySelector('#security-audit-copy-json')
    ?.addEventListener('click', () => void copyAuditJson());
  for (const button of host.querySelectorAll('[data-audit-view]')) {
    button.addEventListener('click', () => setAuditDetailMode(button.dataset.auditView));
  }
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !auditOverlay?.hidden) closeAuditDetails();
  });

  async function loadSettings() {
    if (!canManageSecurity) return;
    const form = host.querySelector('#security-settings-form');
    const message = host.querySelector('#security-settings-message');
    try {
      const payload = await api('/api/admin/security/settings');
      for (const [key, value] of Object.entries(payload.settings)) {
        const control = form.elements[key];
        if (!control) continue;
        if (control.type === 'checkbox') control.checked = Boolean(value);
        else control.value = value;
      }
      bindHumanUnits(form);
      securitySettingsDirty?.markClean();
      setMessage(message, 'Параметры загружены.');
    } catch (error) {
      setMessage(message, error.message, 'error');
    }
  }

  host.querySelector('#security-settings-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const numericKeys = [
      'maxFailedAttempts','failureWindowSeconds','lockoutSeconds',
      'ipMaxFailedAttempts','ipFailureWindowSeconds','ipLockoutSeconds',
      'sessionIdleSeconds','sessionAbsoluteSeconds','auditRetentionDays',
      'passwordMinLength','passwordMaxLength',
    ];
    const booleanKeys = [
      'passwordRequireLowercase','passwordRequireUppercase',
      'passwordRequireDigit','passwordRequireSpecial',
    ];
    const settings = Object.fromEntries([
      ...numericKeys.map((key) => [key, Number(form.elements[key].value)]),
      ...booleanKeys.map((key) => [key, form.elements[key].checked]),
    ]);
    try {
      await api('/api/admin/security/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      securitySettingsDirty?.markClean();
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
