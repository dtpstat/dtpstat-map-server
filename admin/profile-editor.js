import { adminConfirm } from './admin-dialog.js';
import { adminAvatarObjectUrl } from './admin-avatar.js';
import { trackDirtyForm } from './admin-dirty-state.js';

const profileRoot =
  document.querySelector(
    '[data-admin-section-panel="profile"]',
  );
const accountHost =
  document.querySelector(
    '#profile-account-host',
  );
const passwordHost =
  document.querySelector(
    '#profile-password-host',
  );
const mfaHost =
  document.querySelector(
    '#profile-mfa-host',
  );
const profileSessionsHost =
  document.querySelector(
    '#profile-sessions-host',
  );

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

if (
  profileRoot &&
  accountHost &&
  passwordHost &&
  mfaHost &&
  profileSessionsHost
) {
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = '/admin/profile.css';
  document.head.append(stylesheet);

  const profileGrid =
    profileRoot.querySelector(
      '.admin-layout-grid',
    );
  const profileCard =
    profileRoot.querySelector(
      '.admin-layout-card',
    );
  const profileBlocks = {
    profile:
      accountHost.closest(
        '.admin-layout-block',
      ),
    password:
      passwordHost.closest(
        '.admin-layout-block',
      ),
    mfa:
      mfaHost.closest(
        '.admin-layout-block',
      ),
    sessions:
      profileSessionsHost.closest(
        '.admin-layout-block',
      ),
  };

  if (
    profileGrid &&
    profileCard
  ) {
    const tabs =
      document.createElement(
        'nav',
      );
    tabs.className =
      'profile-tabs';
    tabs.setAttribute(
      'role',
      'tablist',
    );
    tabs.setAttribute(
      'aria-label',
      'Разделы профиля',
    );

    const definitions = [
      {
        id: 'profile',
        title: 'Профиль',
        blocks: [
          'profile',
        ],
      },
      {
        id: 'security',
        title:
          'Пароль и MFA',
        blocks: [
          'password',
          'mfa',
        ],
      },
      {
        id: 'sessions',
        title: 'Сессии',
        blocks: [
          'sessions',
        ],
      },
    ];

    const selectProfileTab =
      (id) => {
        for (
          const definition of
          definitions
        ) {
          const active =
            definition.id ===
            id;
          const button =
            tabs.querySelector(
              '[data-profile-tab="' +
              definition.id +
              '"]',
            );
          button?.setAttribute(
            'aria-selected',
            String(active),
          );
          if (button) {
            button.tabIndex =
              active
                ? 0
                : -1;
          }

          for (
            const blockName of
            definition.blocks
          ) {
            const block =
              profileBlocks[
                blockName
              ];
            if (block) {
              block.hidden =
                !active;
            }
          }
        }

        if (id === 'security') {
          profileBlocks.password
            ?.style.setProperty(
              '--admin-block-span-wide',
              '5',
            );
          profileBlocks.mfa
            ?.style.setProperty(
              '--admin-block-span-wide',
              '7',
            );
        }
      };

    for (
      const definition of
      definitions
    ) {
      const button =
        document.createElement(
          'button',
        );
      button.type =
        'button';
      button.role =
        'tab';
      button.dataset
        .profileTab =
        definition.id;
      button.textContent =
        definition.title;
      button.setAttribute(
        'aria-selected',
        'false',
      );
      button.addEventListener(
        'click',
        () =>
          selectProfileTab(
            definition.id,
          ),
      );
      tabs.append(
        button,
      );
    }

    profileCard.insertBefore(
      tabs,
      profileGrid,
    );
    selectProfileTab(
      'profile',
    );
  }

  accountHost.innerHTML = `
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
          <label class="secondary profile-avatar-action profile-file-button">
            <span id="profile-avatar-upload-label">Загрузить аватар</span>
            <input id="profile-avatar-file" type="file" accept="image/png,image/jpeg,image/webp" hidden>
          </label>
          <button type="button" class="secondary profile-avatar-action"
                  id="profile-avatar-delete" disabled>Удалить аватар</button>
        </div>
        <small class="profile-muted">PNG/JPEG/WebP, до 256 КиБ. SVG не принимается.</small>
        <p id="profile-account-message" class="profile-message" role="status"></p>
      </section>
  `;

  passwordHost.innerHTML = `
    <section class="profile-panel">
        <h3>Пароль</h3>
        <div id="profile-password-required" class="profile-warning" hidden>
          Используется временный пароль. До его смены остальные разделы админки недоступны.
        </div>
        <div id="profile-password-policy" class="profile-password-policy" aria-live="polite">
          Загружаем требования к паролю…
        </div>
        <form id="profile-password-form" class="profile-form">
          <label>Текущий пароль
            <input name="currentPassword" type="password" required autocomplete="current-password">
          </label>
          <label>Новый пароль
            <input name="newPassword" type="password" minlength="12" required autocomplete="new-password">
          </label>
          <label>Повторите новый пароль
            <input name="repeatPassword" type="password" minlength="12" required autocomplete="new-password">
          </label>
          <button type="submit">Сменить пароль</button>
        </form>
        <p id="profile-password-message" class="profile-message" role="status"></p>
      </section>
  `;

  mfaHost.innerHTML = `
    <section class="profile-panel profile-mfa-panel">
        <div class="profile-section-heading">
          <div>
            <h3>Multi-factor authentication</h3>
            <p class="profile-muted">TOTP-код из authenticator app или одноразовый recovery code.</p>
          </div>
          <strong id="profile-mfa-state">—</strong>
        </div>

        <div id="profile-mfa-required" class="profile-warning" hidden>
          MFA обязательна. До настройки второго фактора остальные разделы админки недоступны.
        </div>
        <div id="profile-mfa-unavailable" class="profile-warning" hidden>
          MFA недоступна: на сервере не настроен ключ шифрования.
        </div>

        <form id="profile-mfa-enroll-form" class="profile-form">
          <label>Текущий пароль
            <input name="currentPassword" type="password" required autocomplete="current-password">
          </label>
          <button type="submit">Настроить MFA</button>
        </form>

        <div id="profile-mfa-enrollment" class="profile-mfa-enrollment" hidden>
          <p class="profile-muted">
            Добавьте аккаунт в authenticator app по provisioning URI или вручную по secret,
            затем подтвердите шестизначный код.
          </p>
          <label>Secret
            <code id="profile-mfa-secret" class="profile-secret-value"></code>
          </label>
          <label>Provisioning URI
            <code id="profile-mfa-uri" class="profile-secret-value profile-secret-uri"></code>
          </label>
          <form id="profile-mfa-confirm-form" class="profile-form">
            <label>Код из приложения
              <input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6"
                     required autocomplete="one-time-code">
            </label>
            <button type="submit">Подтвердить и включить MFA</button>
          </form>
        </div>

        <div id="profile-mfa-enabled-actions" hidden>
          <p class="profile-muted">
            Неиспользованных recovery codes:
            <strong id="profile-mfa-recovery-count">0</strong>
          </p>
          <details class="profile-mfa-action">
            <summary>Создать новые recovery codes</summary>
            <form id="profile-mfa-recovery-form" class="profile-form">
              <label>Текущий пароль
                <input name="currentPassword" type="password" required autocomplete="current-password">
              </label>
              <label>TOTP или recovery code
                <input name="code" required autocomplete="one-time-code">
              </label>
              <button type="submit">Заменить recovery codes</button>
            </form>
          </details>
          <details class="profile-mfa-action">
            <summary>Отключить MFA</summary>
            <form id="profile-mfa-disable-form" class="profile-form">
              <label>Текущий пароль
                <input name="currentPassword" type="password" required autocomplete="current-password">
              </label>
              <label>TOTP или recovery code
                <input name="code" required autocomplete="one-time-code">
              </label>
              <button type="submit" class="danger" id="profile-mfa-disable">Отключить MFA</button>
            </form>
          </details>
        </div>

        <div id="profile-mfa-recovery-codes" class="profile-mfa-recovery-codes" hidden>
          <strong>Сохраните recovery codes сейчас</strong>
          <p class="profile-muted">После скрытия plaintext-коды получить снова нельзя; можно только выпустить новые.</p>
          <pre id="profile-mfa-recovery-values"></pre>
          <button type="button" class="secondary" id="profile-mfa-recovery-hide">Скрыть codes</button>
        </div>

        <p id="profile-mfa-message" class="profile-message" role="status"></p>
      </section>
  `;

  profileSessionsHost.innerHTML = `
    <section class="profile-panel profile-sessions-panel">
        <div class="profile-section-heading">
          <div>
            <h3>Активные сессии</h3>
            <p class="profile-muted">IP, браузер и время последней активности.</p>
          </div>
          <button type="button" class="danger" id="profile-revoke-others">Завершить остальные</button>
        </div>
        <div id="profile-sessions"></div>
        <p id="profile-sessions-message" class="profile-message" role="status"></p>
      </section>
  `;

  const accountForm = profileRoot.querySelector('#profile-account-form');
  const passwordForm = profileRoot.querySelector('#profile-password-form');
  const accountMessage = profileRoot.querySelector('#profile-account-message');
  const passwordMessage = profileRoot.querySelector('#profile-password-message');
  const sessionsMessage = profileRoot.querySelector('#profile-sessions-message');
  const sessionsHost = profileRoot.querySelector('#profile-sessions');
  const mfaMessage = profileRoot.querySelector('#profile-mfa-message');
  const mfaEnrollForm = profileRoot.querySelector('#profile-mfa-enroll-form');
  const mfaConfirmForm = profileRoot.querySelector('#profile-mfa-confirm-form');
  const mfaRecoveryForm = profileRoot.querySelector('#profile-mfa-recovery-form');
  const mfaDisableForm = profileRoot.querySelector('#profile-mfa-disable-form');
  const accountDirty = trackDirtyForm(accountForm, { label: 'Профиль' });
  let currentSessionId = null;
  let currentUser = null;
  let passwordPolicy = null;
  let mfaStatus = null;

  function passwordPolicyError(value) {
    if (!passwordPolicy) return null;
    if (value.length < passwordPolicy.passwordMinLength) {
      return `Пароль должен содержать минимум ${passwordPolicy.passwordMinLength} символов.`;
    }
    if (value.length > passwordPolicy.passwordMaxLength) {
      return 'Пароль слишком длинный.';
    }
    if (passwordPolicy.passwordRequireLowercase && !/\p{Ll}/u.test(value)) {
      return 'Добавьте хотя бы одну строчную букву.';
    }
    if (passwordPolicy.passwordRequireUppercase && !/\p{Lu}/u.test(value)) {
      return 'Добавьте хотя бы одну прописную букву.';
    }
    if (passwordPolicy.passwordRequireDigit && !/\p{N}/u.test(value)) {
      return 'Добавьте хотя бы одну цифру.';
    }
    if (passwordPolicy.passwordRequireSpecial && !/[^\p{L}\p{N}]/u.test(value)) {
      return 'Добавьте хотя бы один спецсимвол.';
    }
    return null;
  }

  function renderPasswordPolicy(policy) {
    passwordPolicy = policy;
    for (const input of [
      passwordForm.elements.newPassword,
      passwordForm.elements.repeatPassword,
    ]) {
      input.minLength = policy.passwordMinLength;
      input.removeAttribute('maxlength');
    }
    const requirements = [
      `минимум ${policy.passwordMinLength} символов`,
      policy.passwordRequireLowercase ? 'минимум одна строчная буква' : null,
      policy.passwordRequireUppercase ? 'минимум одна прописная буква' : null,
      policy.passwordRequireDigit ? 'минимум одна цифра' : null,
      policy.passwordRequireSpecial ? 'минимум один спецсимвол' : null,
    ].filter(Boolean);
    profileRoot.querySelector('#profile-password-policy').innerHTML =
      `<strong>Требования к новому паролю</strong><ul>${
        requirements.map((item) => `<li>${item}</li>`).join('')
      }</ul>`;
  }

  async function loadPasswordPolicy() {
    const payload = await api('/api/admin/profile/password-policy');
    renderPasswordPolicy(payload.policy);
  }

  let avatarRequestSequence = 0;

  function updateAvatar(user) {
    const image = profileRoot.querySelector('#profile-avatar');
    const fallback = profileRoot.querySelector('#profile-avatar-fallback');
    const fallbackText = (user.displayName || user.username || '?').trim().slice(0, 1).toUpperCase();
    const requestSequence =
      ++avatarRequestSequence;

    fallback.textContent = fallbackText;
    image.hidden = true;
    fallback.hidden = false;

    if (!user.hasAvatar) {
      image.removeAttribute('src');
      return;
    }

    const avatarVersion =
      encodeURIComponent(
        user.updatedAt ?? '1',
      );
    const avatarUrl =
      `/api/admin/profile/avatar?v=${avatarVersion}`;

    void adminAvatarObjectUrl(
      avatarUrl,
    )
      .then(
        (objectUrl) => {
          if (
            requestSequence !==
            avatarRequestSequence
          ) {
            return;
          }

          image.src =
            objectUrl;
          image.hidden =
            false;
          fallback.hidden =
            true;
        },
      )
      .catch(
        () => {
          if (
            requestSequence !==
            avatarRequestSequence
          ) {
            return;
          }

          image.removeAttribute(
            'src',
          );
          image.hidden =
            true;
          fallback.hidden =
            false;
        },
      );
  }

  function renderUser(user) {
    currentUser = user;
    accountForm.elements.username.value = user.username;
    accountForm.elements.displayName.value = user.displayName ?? user.username;
    accountForm.elements.email.value = user.email ?? '';
    profileRoot.querySelector('#profile-display-heading').textContent = user.displayName ?? user.username;
    profileRoot.querySelector('#profile-login-heading').textContent = `@${user.username}`;
    profileRoot.querySelector('#profile-password-required').hidden = !user.mustChangePassword;
    profileRoot.querySelector('#profile-avatar-delete').disabled = !user.hasAvatar;
    profileRoot.querySelector('#profile-avatar-upload-label').textContent =
      user.hasAvatar ? 'Заменить аватар' : 'Загрузить аватар';
    updateAvatar(user);
    accountDirty?.markClean();
  }

  async function refreshSessionUser(
    fallbackUser = null,
  ) {
    if (
      typeof globalThis
        .dtpstatReloadAdminSession ===
      'function'
    ) {
      return globalThis
        .dtpstatReloadAdminSession();
    }

    if (fallbackUser) {
      renderUser(
        fallbackUser,
      );
    }

    return null;
  }

  async function loadSession() {
    if (
      typeof globalThis
        .dtpstatReloadAdminSession ===
      'function'
    ) {
      const session =
        await globalThis
          .dtpstatReloadAdminSession();
      currentSessionId =
        session.sessionId ??
        null;
      return session;
    }

    const session =
      await globalThis
        .dtpstatAdminSession;
    currentSessionId =
      session.sessionId ??
      null;
    renderUser(
      session.user,
    );
    return session;
  }

  function hideRecoveryCodes() {
    const panel =
      profileRoot.querySelector(
        '#profile-mfa-recovery-codes',
      );
    const values =
      profileRoot.querySelector(
        '#profile-mfa-recovery-values',
      );
    values.textContent = '';
    panel.hidden = true;
  }

  function showRecoveryCodes(
    codes,
  ) {
    const panel =
      profileRoot.querySelector(
        '#profile-mfa-recovery-codes',
      );
    const values =
      profileRoot.querySelector(
        '#profile-mfa-recovery-values',
      );
    values.textContent =
      codes.join('\n');
    panel.hidden = false;
  }

  function renderMfaStatus(
    status,
  ) {
    mfaStatus = status;
    const enabled =
      Boolean(
        status.enabled,
      );
    const required =
      Boolean(
        status.required,
      );

    profileRoot.querySelector(
      '#profile-mfa-state',
    ).textContent =
      enabled
        ? 'Включена'
        : 'Выключена';

    profileRoot.querySelector(
      '#profile-mfa-required',
    ).hidden =
      !required ||
      enabled;

    profileRoot.querySelector(
      '#profile-mfa-unavailable',
    ).hidden =
      Boolean(
        status.available,
      );

    mfaEnrollForm.hidden =
      enabled;

    mfaEnrollForm
      .querySelector(
        'button',
      ).disabled =
      !status.available;

    profileRoot.querySelector(
      '#profile-mfa-enrollment',
    ).hidden =
      !status.enrollmentPending;

    profileRoot.querySelector(
      '#profile-mfa-enabled-actions',
    ).hidden =
      !enabled;

    profileRoot.querySelector(
      '#profile-mfa-recovery-count',
    ).textContent =
      String(
        status.recoveryCodesRemaining ??
        0,
      );

    const disableButton =
      profileRoot.querySelector(
        '#profile-mfa-disable',
      );
    disableButton.disabled =
      required;
    disableButton.title =
      required
        ? 'MFA обязательна политикой безопасности'
        : '';
  }

  async function loadMfaStatus() {
    const payload =
      await api(
        '/api/admin/profile/mfa',
      );
    renderMfaStatus(
      payload.mfa,
    );
    return payload.mfa;
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
      <button type="button" class="danger">Завершить</button>
    `;
    card.querySelector('.profile-muted').textContent = [
      session.ipAddress ?? 'IP неизвестен',
      `создана ${formatDate(session.createdAt)}`,
      `активность ${formatDate(session.lastSeenAt)}`,
      session.userAgent ?? '',
    ].filter(Boolean).join(' · ');
    const button = card.querySelector('button');
    button.addEventListener('click', async () => {
      const confirmed = await adminConfirm({
        title: current ? 'Завершить текущую сессию?' : 'Завершить сессию?',
        message: current
          ? 'Текущая сессия будет завершена, после чего потребуется войти снова.'
          : 'Выбранная сессия будет немедленно отозвана.',
        confirmLabel: current ? 'Завершить и выйти' : 'Завершить',
        cancelLabel: 'Отмена',
        destructive: true,
      });
      if (!confirmed) return;
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
      await refreshSessionUser(
        payload.user,
      );
      message(accountMessage, 'Профиль сохранён.', 'success');
    } catch (error) {
      message(accountMessage, error.message, 'error');
    }
  });

  passwordForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!passwordForm.reportValidity()) return;
    const policyError = passwordPolicyError(passwordForm.elements.newPassword.value);
    if (policyError) {
      message(passwordMessage, policyError, 'error');
      return;
    }
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
      await refreshSessionUser(
        payload.user,
      );
      window.dispatchEvent(new CustomEvent('dtpstat:password-changed'));
      message(passwordMessage, 'Пароль изменён. Остальные сессии завершены.', 'success');
    } catch (error) {
      message(passwordMessage, error.message, 'error');
    }
  });

  mfaEnrollForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!mfaEnrollForm.reportValidity()) return;
    hideRecoveryCodes();

    try {
      const payload =
        await api(
          '/api/admin/profile/mfa/enroll',
          {
            method: 'POST',
            headers: {
              'Content-Type':
                'application/json',
            },
            body: JSON.stringify({
              currentPassword:
                mfaEnrollForm
                  .elements
                  .currentPassword
                  .value,
            }),
          },
        );

      mfaEnrollForm.reset();

      profileRoot.querySelector(
        '#profile-mfa-secret',
      ).textContent =
        payload.enrollment.secret;

      profileRoot.querySelector(
        '#profile-mfa-uri',
      ).textContent =
        payload.enrollment
          .provisioningUri;

      profileRoot.querySelector(
        '#profile-mfa-enrollment',
      ).hidden =
        false;

      message(
        mfaMessage,
        'Enrollment создан. Подтвердите код из authenticator app.',
        'success',
      );

      await loadMfaStatus();
    } catch (error) {
      message(
        mfaMessage,
        error.message,
        'error',
      );
    }
  });

  mfaConfirmForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!mfaConfirmForm.reportValidity()) return;

    try {
      const payload =
        await api(
          '/api/admin/profile/mfa/confirm',
          {
            method: 'POST',
            headers: {
              'Content-Type':
                'application/json',
            },
            body: JSON.stringify({
              code:
                mfaConfirmForm
                  .elements
                  .code
                  .value,
            }),
          },
        );

      mfaConfirmForm.reset();

      profileRoot.querySelector(
        '#profile-mfa-secret',
      ).textContent = '';
      profileRoot.querySelector(
        '#profile-mfa-uri',
      ).textContent = '';

      showRecoveryCodes(
        payload.mfa
          .recoveryCodes,
      );

      await loadMfaStatus();
      await globalThis
        .dtpstatReloadAdminSession?.();

      message(
        mfaMessage,
        'MFA включена. Сохраните recovery codes.',
        'success',
      );
    } catch (error) {
      message(
        mfaMessage,
        error.message,
        'error',
      );
    }
  });

  mfaRecoveryForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!mfaRecoveryForm.reportValidity()) return;

    try {
      const payload =
        await api(
          '/api/admin/profile/mfa/recovery-codes',
          {
            method: 'POST',
            headers: {
              'Content-Type':
                'application/json',
            },
            body: JSON.stringify({
              currentPassword:
                mfaRecoveryForm
                  .elements
                  .currentPassword
                  .value,
              code:
                mfaRecoveryForm
                  .elements
                  .code
                  .value,
            }),
          },
        );

      mfaRecoveryForm.reset();

      showRecoveryCodes(
        payload.mfa
          .recoveryCodes,
      );

      await loadMfaStatus();

      message(
        mfaMessage,
        'Recovery codes заменены.',
        'success',
      );
    } catch (error) {
      message(
        mfaMessage,
        error.message,
        'error',
      );
    }
  });

  mfaDisableForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!mfaDisableForm.reportValidity()) return;

    if (
      mfaStatus?.required
    ) {
      message(
        mfaMessage,
        'MFA обязательна политикой безопасности.',
        'error',
      );
      return;
    }

    const confirmed =
      await adminConfirm({
        title:
          'Отключить MFA?',
        message:
          'Второй фактор и recovery codes будут удалены. Остальные активные сессии завершатся.',
        confirmLabel:
          'Отключить MFA',
        cancelLabel:
          'Отмена',
        destructive:
          true,
      });

    if (!confirmed) return;

    try {
      await api(
        '/api/admin/profile/mfa',
        {
          method: 'DELETE',
          headers: {
            'Content-Type':
              'application/json',
          },
          body: JSON.stringify({
            currentPassword:
              mfaDisableForm
                .elements
                .currentPassword
                .value,
            code:
              mfaDisableForm
                .elements
                .code
                .value,
          }),
        },
      );

      mfaDisableForm.reset();
      hideRecoveryCodes();

      await loadMfaStatus();
      await globalThis
        .dtpstatReloadAdminSession?.();

      message(
        mfaMessage,
        'MFA отключена.',
        'success',
      );
    } catch (error) {
      message(
        mfaMessage,
        error.message,
        'error',
      );
    }
  });

  profileRoot.querySelector(
    '#profile-mfa-recovery-hide',
  ).addEventListener(
    'click',
    hideRecoveryCodes,
  );

  profileRoot.querySelector('#profile-avatar-file').addEventListener('change', async (event) => {
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
      await refreshSessionUser(
        payload.user,
      );
      message(accountMessage, 'Аватар обновлён.', 'success');
    } catch (error) {
      message(accountMessage, error.message, 'error');
    } finally {
      event.target.value = '';
    }
  });

  profileRoot.querySelector('#profile-avatar-delete').addEventListener('click', async () => {
    if (!currentUser?.hasAvatar) return;
    try {
      const payload = await api('/api/admin/profile/avatar', { method: 'DELETE' });
      await refreshSessionUser(
        payload.user,
      );
      message(accountMessage, 'Аватар удалён.', 'success');
    } catch (error) {
      message(accountMessage, error.message, 'error');
    }
  });

  profileRoot.querySelector('#profile-revoke-others').addEventListener('click', async () => {
    const confirmed = await adminConfirm({
      title: 'Завершить остальные сессии?',
      message: 'Все активные сессии этой учётной записи, кроме текущей, будут отозваны.',
      confirmLabel: 'Завершить остальные',
      cancelLabel: 'Отмена',
      destructive: true,
    });
    if (!confirmed) return;
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
  await Promise.all([
    loadSessions(),
    loadPasswordPolicy(),
    loadMfaStatus(),
  ]);
}
