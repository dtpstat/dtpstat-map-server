import { adminAvatarObjectUrl } from './admin-avatar.js';
import { adminAlert, adminConfirm } from './admin-dialog.js';
import { trackDirtyForm } from './admin-dirty-state.js';
import { bindHumanUnits } from './admin-human-units.js';
import {
  ensureAdminTabGroup,
  setupAdminTabGroup,
} from './admin-layout.js';
import {
  adminSecurityLayout,
  adminSecuritySettingsLayout,
} from './admin-layout-schema.js';
import { readTabState, writeTabState } from './admin-tab-state.js';

const session = await globalThis.dtpstatAdminSession?.catch(() => null);
const currentUser = session?.user;
const usersAuditHost =
  document.querySelector(
    '#security-users-audit-host',
  );
const securityControlHost =
  document.querySelector(
    '#security-control-host',
  );

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

if (
  (
    usersAuditHost ||
    securityControlHost
  ) &&
  (
    canManageUsers ||
    canViewAudit ||
    canManageSecurity
  )
) {
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = '/admin/security-v2.css';
  document.head.append(stylesheet);

  if (
    canManageSecurity &&
    securityControlHost
  ) {
    securityControlHost.innerHTML =
      '<div id="security-settings-panels"></div>';

    ensureAdminTabGroup({
      root:
        securityControlHost,
      definition:
        adminSecuritySettingsLayout
          .tabs,
    });
  }

  const securitySettingsHost =
    document.querySelector(
      '#security-protection-host',
    );
  const securityMetricsTimingsHost =
    document.querySelector(
      '#security-metrics-timings-host',
    );
  const securityIpHost =
    document.querySelector(
      '#security-blocks-host',
    );

  const securityTabDefinition = {
    ...adminSecurityLayout.tabs,
    items:
      adminSecurityLayout.tabs
        .items.filter(
          (item) =>
            (
              item.id === 'users' &&
              canManageUsers
            ) ||
            (
              item.id === 'audit' &&
              canViewAudit
            ),
        ),
  };

  if (
    usersAuditHost &&
    (
      canManageUsers ||
      canViewAudit
    )
  ) {
    usersAuditHost.innerHTML =
      '<div id="security-panels"></div>';
  }

  let overlaysHost =
    document.querySelector(
      '#security-overlays-host',
    );

  if (!overlaysHost) {
    overlaysHost =
      document.createElement(
        'div',
      );
    overlaysHost.id =
      'security-overlays-host';
    document.body.append(
      overlaysHost,
    );
  }

  overlaysHost.innerHTML = `
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

  if (
    usersAuditHost &&
    securityTabDefinition
      .items.length
  ) {
    ensureAdminTabGroup({
      root:
        usersAuditHost,
      definition:
        securityTabDefinition,
    });
  }

  const securityPanels = {
    users:
      document.querySelector(
        '#security-panel-users',
      ),
    audit:
      document.querySelector(
        '#security-panel-audit',
      ),
  };

  if (securityPanels.users) {
    securityPanels.users.innerHTML = `
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
    `;
  }

  const securityAuditHost =
    document.querySelector(
      '#security-audit-host',
    );

  if (securityAuditHost) {
    securityAuditHost.innerHTML = `
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
    `;
  }

  if (
    canManageSecurity &&
    securitySettingsHost
  ) {
    securitySettingsHost.innerHTML = `
<form id="security-settings-form" class="security-settings-form">
            <h3>Защита</h3>
            <fieldset><legend>Политика паролей</legend>
              <div class="security-password-policy-row">
                <label class="security-password-minimum">
                  Минимум символов
                  <input name="passwordMinLength" type="number" min="1" max="4096" required>
                </label>
                <input name="passwordMaxLength" type="hidden">
                <div class="security-password-requirements">
                  <label class="check"><input name="passwordRequireLowercase" type="checkbox"> Строчная буква</label>
                  <label class="check"><input name="passwordRequireUppercase" type="checkbox"> Прописная буква</label>
                  <label class="check"><input name="passwordRequireDigit" type="checkbox"> Цифра</label>
                  <label class="check"><input name="passwordRequireSpecial" type="checkbox"> Спецсимвол</label>
                </div>
                <p class="security-info">Требования показываются пользователю при смене пароля.</p>
              </div>
            </fieldset>

            <section class="security-mfa-policy-panel" aria-labelledby="security-mfa-policy-title">
              <div class="security-mfa-policy-heading">
                <div>
                  <h3 id="security-mfa-policy-title">Multi-factor authentication</h3>
                  <p class="security-info">
                    При обязательной MFA пользователь без второго фактора получает
                    доступ только к профилю до завершения настройки.
                  </p>
                </div>
                <label class="security-mfa-policy-toggle">
                  <input name="mfaRequired" type="checkbox">
                  <span>Обязательна</span>
                </label>
              </div>
            </section>

            <section class="security-metrics-panel" aria-labelledby="security-metrics-title">
              <div class="security-metrics-heading">
                <div>
                  <h3 id="security-metrics-title">Prometheus metrics</h3>
                  <p class="security-info">
                    Эксплуатационный мониторинг приложения через защищённый
                    <code>/metrics</code>.
                  </p>
                </div>
                <label class="security-metrics-toggle">
                  <input name="metricsEnabled" type="checkbox">
                  <span>Включено</span>
                </label>
              </div>
              <div class="security-metrics-body">
                <p id="security-metrics-token-status" class="security-info">
                  Проверяем состояние bearer token…
                </p>
                <div class="security-metrics-actions">
                  <button type="button" class="secondary"
                          id="security-metrics-token-rotate"
                          data-dirty-ignore>
                    Сгенерировать token
                  </button>
                  <button type="button" class="danger"
                          id="security-metrics-token-clear"
                          data-dirty-ignore>
                    Очистить token
                  </button>
                </div>
                <p class="security-info">
                  Token показывается только один раз. В базе хранится только SHA-256 hash.
                  После ротации старый token перестаёт работать сразу.
                </p>
              </div>
            </section>

            <details class="admin-advanced-settings">
              <summary>Тонкая настройка блокировок, сессий и аудита</summary>
              <div class="admin-advanced-settings-body">
                <p class="admin-advanced-settings-note">Эти параметры обычно меняет технический администратор. Рядом с секундами показывается привычное время.</p>
                <fieldset id="security-lockout-user-settings"><legend>Учётная запись</legend>
                  <label>Попыток до блокировки <input name="maxFailedAttempts" type="number" min="1" max="100" required></label>
                  <label>Окно попыток, сек. <input name="failureWindowSeconds" type="number" min="10" max="86400" required data-human-unit="seconds"></label>
                  <label>Блокировка, сек. <input name="lockoutSeconds" type="number" min="10" max="604800" required data-human-unit="seconds"></label>
                </fieldset>
                <fieldset id="security-lockout-ip-settings"><legend>IP</legend>
                  <label>Попыток до IP lockout <input name="ipMaxFailedAttempts" type="number" min="1" max="1000" required></label>
                  <label>Окно IP, сек. <input name="ipFailureWindowSeconds" type="number" min="10" max="86400" required data-human-unit="seconds"></label>
                  <label>IP lockout, сек. <input name="ipLockoutSeconds" type="number" min="10" max="604800" required data-human-unit="seconds"></label>
                </fieldset>
                <fieldset id="security-rate-limit-settings"><legend>HTTP rate limit</legend>
                  <label>На пользователя, запросов/мин <input name="requestRateLimitUserPerMinute" type="number" min="10" max="60000" required></label>
                  <label>Суммарно, запросов/мин <input name="requestRateLimitGlobalPerMinute" type="number" min="10" max="1000000" required></label>
                  <p class="security-info">Лимиты применяются к успешно аутентифицированным HTTP-запросам админки. Глобальный лимит должен быть не меньше пользовательского.</p>
                </fieldset>
                <fieldset id="security-timing-settings"><legend>Сессии и аудит</legend>
                  <label>Idle timeout, сек. <input name="sessionIdleSeconds" type="number" min="60" max="86400" required data-human-unit="seconds"></label>
                  <label>Максимальная жизнь сессии, сек. <input name="sessionAbsoluteSeconds" type="number" min="300" max="2592000" required data-human-unit="seconds"></label>
                  <label>Хранить аудит, дней (0 = бессрочно) <input name="auditRetentionDays" type="number" min="0" max="3650" required data-human-unit="days"></label>
                </fieldset>
              </div>
            </details>
            <button type="submit">Сохранить защиту</button>
            <p id="security-settings-message" class="security-message" role="status"></p>
          </form>
    `;
  }

  if (
    canManageSecurity &&
    securityIpHost
  ) {
    securityIpHost.innerHTML = `
<section class="security-ip-panel">
            <h3>Ручные блокировки IP</h3>
            <form id="security-ip-block-form" class="security-ip-block-form">
              <label>IP <input name="ipAddress" type="text" required placeholder="203.0.113.10"></label>
              <label>Срок <select name="durationSeconds">${durationOptions()}</select></label>
              <label>Причина <input name="reason" type="text" maxlength="500"></label>
              <button type="submit">Заблокировать IP</button>
            </form>
            <p id="security-ip-message" class="security-message" role="status"></p>
          </section>
    `;
  }

  if (
    canManageSecurity &&
    securityControlHost
  ) {
    setupAdminTabGroup({
      root:
        securityControlHost,
      definition:
        adminSecuritySettingsLayout
          .tabs,
      readState:
        readTabState,
      writeState:
        writeTabState,
    });

    for (
      const panel of
      securityControlHost
        .querySelectorAll(
          '[data-security-settings-panel]',
        )
    ) {
      panel.dataset
        .dirtyFormId =
        'security-settings-form';
    }
  }

  if (
    canManageSecurity &&
    securityControlHost &&
    !document.querySelector(
      '#security-settings-status',
    )
  ) {
    const status =
      document.createElement(
        'p',
      );
    status.id =
      'security-settings-status';
    status.className =
      'security-message';
    status.setAttribute(
      'role',
      'status',
    );
    securityControlHost.append(
      status,
    );
  }

  const securitySettingsForm =
    document.querySelector(
      '#security-settings-form',
    );

  const securityMetricsPanel =
    document.querySelector(
      '.security-metrics-panel',
    );
  const securityTimingSettings =
    document.querySelector(
      '#security-timing-settings',
    );
  const securityRateLimitSettings =
    document.querySelector(
      '#security-rate-limit-settings',
    );
  const securityLockoutUserSettings =
    document.querySelector(
      '#security-lockout-user-settings',
    );
  const securityLockoutIpSettings =
    document.querySelector(
      '#security-lockout-ip-settings',
    );
  const securityAdvancedSettings =
    document.querySelector(
      '.admin-advanced-settings',
    );

  function attachSecuritySettingsForm(
    node,
  ) {
    if (!node) return;
    for (
      const control of
      node.querySelectorAll(
        'input,select,textarea,button',
      )
    ) {
      if (
        control.type ===
          'button' ||
        control.hasAttribute(
          'data-dirty-ignore',
        )
      ) {
        continue;
      }
      control.setAttribute(
        'form',
        'security-settings-form',
      );
    }
  }

  if (
    securityMetricsTimingsHost &&
    securitySettingsForm
  ) {
    const heading =
      document.createElement(
        'h3',
      );
    heading.textContent =
      'Метрики и тайминги';
    securityMetricsTimingsHost.append(
      heading,
    );
    for (
      const node of [
        securityMetricsPanel,
        securityTimingSettings,
        securityRateLimitSettings,
      ]
    ) {
      if (!node) continue;
      attachSecuritySettingsForm(
        node,
      );
      securityMetricsTimingsHost.append(
        node,
      );
    }
    const save =
      document.createElement(
        'button',
      );
    save.type =
      'submit';
    save.setAttribute(
      'form',
      'security-settings-form',
    );
    save.textContent =
      'Сохранить метрики и тайминги';
    securityMetricsTimingsHost.append(
      save,
    );
  }

  if (
    securityIpHost &&
    securitySettingsForm
  ) {
    const policy =
      document.createElement(
        'section',
      );
    policy.className =
      'security-block-policy';
    const heading =
      document.createElement(
        'h3',
      );
    heading.textContent =
      'Политика блокировок';
    policy.append(
      heading,
    );
    for (
      const node of [
        securityLockoutUserSettings,
        securityLockoutIpSettings,
      ]
    ) {
      if (!node) continue;
      attachSecuritySettingsForm(
        node,
      );
      policy.append(
        node,
      );
    }
    const save =
      document.createElement(
        'button',
      );
    save.type =
      'submit';
    save.setAttribute(
      'form',
      'security-settings-form',
    );
    save.textContent =
      'Сохранить политику блокировок';
    policy.append(
      save,
    );
    securityIpHost.prepend(
      policy,
    );
  }

  securityAdvancedSettings
    ?.remove();

  if (
    canManageSecurity &&
    securityIpHost
  ) {
    const summary =
      document.createElement(
        'section',
      );
    summary.className =
      'security-block-summary';
    summary.innerHTML = `
      <div class="security-block-summary-heading">
        <div>
          <h3>Текущие блокировки</h3>
          <p class="security-info">
            Активные блокировки пользователей и IP в одной таблице.
          </p>
        </div>
        <label>
          Фильтр
          <input id="security-block-filter"
                 type="search"
                 placeholder="USER, IP, причина…">
        </label>
      </div>
      <p id="security-block-role-note"
         class="security-info"
         ${canManageUsers ? 'hidden' : ''}>
        USER-блокировки доступны только роли управления пользователями.
      </p>
      <div class="security-block-table-wrap">
        <table class="security-block-table">
          <thead>
            <tr>
              <th>Тип</th>
              <th>Объект</th>
              <th>До</th>
              <th>Причина</th>
              <th>Действие</th>
            </tr>
          </thead>
          <tbody id="security-blocks-body"></tbody>
        </table>
      </div>
      <p id="security-blocks-message"
         class="security-message"
         role="status"></p>
    `;
    securityIpHost.append(
      summary,
    );
  }

  const securitySettingsDirty = trackDirtyForm(
    securitySettingsForm,
    { label: 'Параметры безопасности' },
  );
  for (
    const movedHost of [
      securityMetricsTimingsHost,
      securityIpHost,
    ]
  ) {
    movedHost?.addEventListener(
      'input',
      (event) => {
        if (
          event.target
            ?.getAttribute?.('form') ===
          'security-settings-form'
        ) {
          securitySettingsDirty
            ?.markDirty();
        }
      },
    );
    movedHost?.addEventListener(
      'change',
      (event) => {
        if (
          event.target
            ?.getAttribute?.('form') ===
          'security-settings-form'
        ) {
          securitySettingsDirty
            ?.markDirty();
        }
      },
    );
  }
  bindHumanUnits(document);
  const userById = new Map();
  const avatarRequestByElement =
    new WeakMap();

  function applyAvatarBackground(
    avatar,
    fallback,
    url,
  ) {
    const requestKey =
      Symbol('avatar-request');

    avatarRequestByElement.set(
      avatar,
      requestKey,
    );
    avatar.style.removeProperty(
      'background-image',
    );
    avatar.classList.remove(
      'is-image-loaded',
    );
    fallback.hidden = false;

    void adminAvatarObjectUrl(
      url,
    )
      .then(
        (objectUrl) => {
          if (
            avatarRequestByElement.get(
              avatar,
            ) !== requestKey
          ) {
            return;
          }

          avatar.style.backgroundImage =
            `url("${objectUrl}")`;
          avatar.classList.add(
            'is-image-loaded',
          );
        },
      )
      .catch(
        () => {
          if (
            avatarRequestByElement.get(
              avatar,
            ) !== requestKey
          ) {
            return;
          }

          avatar.style.removeProperty(
            'background-image',
          );
          avatar.classList.remove(
            'is-image-loaded',
          );
          fallback.hidden = false;
        },
      );
  }

  let selectedUserId = null;
  let auditOffset = 0;
  const auditLimit = 100;
  let secretTimer = null;
  let metricsTokenConfigured = false;
  let auditDetailEntry = null;
  let auditDetailMode = 'tree';
  const jsonBranchRenderers = new WeakMap();

  if (
    usersAuditHost &&
    securityTabDefinition
      .items.length
  ) {
    setupAdminTabGroup({
      root:
        usersAuditHost,
      definition:
        securityTabDefinition,
      readState:
        readTabState,
      writeState:
        writeTabState,
      onSelect:
        (key) => {
          if (key === 'audit') {
            void loadAudit();
          }
        },
    });
  }

  function showTemporaryPassword(password, username) {
    const overlay = document.querySelector('#security-secret-overlay');
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

  function showMetricsBearerToken(token) {
    const overlay = document.querySelector('#security-secret-overlay');
    if (secretTimer) clearTimeout(secretTimer);
    overlay.hidden = false;
    overlay.innerHTML = `
      <div class="security-secret-card" role="dialog" aria-modal="true"
           aria-label="Prometheus bearer token">
        <h3>Новый Prometheus bearer token</h3>
        <p>Скопируйте token сейчас. После закрытия его plaintext больше получить нельзя.</p>
        <code class="security-secret-value"></code>
        <div class="security-secret-actions">
          <button type="button" id="security-secret-copy">Копировать</button>
          <button type="button" class="secondary" id="security-secret-close">Закрыть</button>
        </div>
        <small>В базе сохранён только SHA-256 hash. Ротация немедленно отменяет предыдущий token.</small>
      </div>
    `;
    overlay.querySelector('.security-secret-value').textContent = token;
    const close = () => {
      overlay.querySelector('.security-secret-value').textContent = '';
      overlay.replaceChildren();
      overlay.hidden = true;
      if (secretTimer) clearTimeout(secretTimer);
      secretTimer = null;
    };
    overlay.querySelector('#security-secret-copy').addEventListener('click', async () => {
      await navigator.clipboard.writeText(token);
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
    const detail = document.querySelector('#security-user-detail');
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
          ${user.mfaEnabled ? '<span>MFA</span>' : ''}
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
            ${roleCheckbox('canEditGeometries', 'Редактирование геометрий', user.canEditGeometries, protectedUser)}
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
          ${currentUser.isSuperuser && user.mfaEnabled && !isSelf
            ? '<button type="button" class="danger" id="security-user-mfa-reset">Сбросить MFA</button>'
            : ''}
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
            canEditGeometries: form.elements.canEditGeometries.checked,
            canManageUsers: form.elements.canManageUsers.checked,
            canViewAudit: form.elements.canViewAudit.checked,
            canManageSecurity: form.elements.canManageSecurity.checked,
          }),
        });
        userById.set(
          user.id,
          payload.user,
        );
        await loadUsers(
          user.id,
        );
        setMessage(
          document.querySelector(
            '#security-users-message',
          ),
          'Пользователь сохранён.',
          'success',
        );
      } catch (error) {
        setMessage(document.querySelector('#security-users-message'), error.message, 'error');
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
        setMessage(document.querySelector('#security-users-message'), error.message, 'error');
      }
    });

    detail.querySelector('#security-user-mfa-reset')
      ?.addEventListener('click', async () => {
        const confirmed = await adminConfirm({
          title: 'Сбросить MFA?',
          message:
            `MFA пользователя ${user.username} будет отключена, recovery codes и активные MFA challenge удалены, все его сессии будут завершены.`,
          confirmLabel:
            'Сбросить MFA',
          cancelLabel:
            'Отмена',
          destructive:
            true,
        });
        if (!confirmed) return;

        try {
          await api(
            `/api/admin/security/users/${user.id}/mfa`,
            {
              method:
                'DELETE',
            },
          );
          await loadUsers(
            user.id,
          );
          setMessage(
            document.querySelector(
              '#security-users-message',
            ),
            'MFA пользователя сброшена; активные сессии завершены.',
            'success',
          );
        } catch (error) {
          setMessage(
            document.querySelector(
              '#security-users-message',
            ),
            error.message,
            'error',
          );
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
        setMessage(
          document.querySelector(
            '#security-users-message',
          ),
          'Пользователь заблокирован.',
          'success',
        );
      } catch (error) {
        setMessage(document.querySelector('#security-users-message'), error.message, 'error');
      }
    });
    detail.querySelector('#security-user-unblock')?.addEventListener('click', async () => {
      try {
        await api(`/api/admin/security/users/${user.id}/unblock`, { method: 'POST' });
        await loadUsers(user.id);
        setMessage(
          document.querySelector(
            '#security-users-message',
          ),
          'Пользователь разблокирован.',
          'success',
        );
      } catch (error) {
        setMessage(document.querySelector('#security-users-message'), error.message, 'error');
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
        setMessage(document.querySelector('#security-users-message'), error.message, 'error');
      }
    });
  }

  function renderNewUser() {
    const detail = document.querySelector('#security-user-detail');
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
            ${roleCheckbox('canEditGeometries', 'Редактирование геометрий', false, false)}
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
            canEditGeometries: form.elements.canEditGeometries.checked,
            canManageUsers: form.elements.canManageUsers.checked,
            canViewAudit: form.elements.canViewAudit.checked,
            canManageSecurity: form.elements.canManageSecurity.checked,
          }),
        });
        showTemporaryPassword(payload.temporaryPassword, payload.user.username);
        await loadUsers(payload.user.id);
      } catch (error) {
        setMessage(document.querySelector('#security-users-message'), error.message, 'error');
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
      for (const row of document.querySelectorAll('.security-user-row')) {
        row.classList.toggle('is-selected', row.dataset.userId === String(user.id));
      }
      renderDetail(user);
    });
    return button;
  }

  function renderUsersList() {
    const query = document.querySelector('#security-user-search')?.value.trim().toLocaleLowerCase('ru-RU') ?? '';
    const users = [...userById.values()].filter((user) => {
      if (!query) return true;
      return [user.username, user.displayName, user.email]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase('ru-RU').includes(query));
    });
    document.querySelector('#security-users-list')?.replaceChildren(...users.map(userListRow));
  }

  async function loadUsers(selectId = selectedUserId) {
    if (!canManageUsers) return;
    const message = document.querySelector('#security-users-message');
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
      renderBlockSummary();
      setMessage(message, `Пользователей: ${payload.users.length}`);
    } catch (error) {
      setMessage(message, error.message, 'error');
    }
  }

  document.querySelector('#security-user-search')?.addEventListener('input', renderUsersList);
  document.querySelector('#security-user-add')?.addEventListener('click', renderNewUser);

  function auditQuery({ exportMode = false } = {}) {
    const form = document.querySelector('#security-audit-filter');
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
    const tree = document.querySelector('#security-audit-json-tree');
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
    const tree = document.querySelector('#security-audit-json-tree');
    const raw = document.querySelector('#security-audit-json-raw');
    tree.hidden = auditDetailMode !== 'tree';
    raw.hidden = auditDetailMode !== 'raw';
    for (const button of document.querySelectorAll('[data-audit-view]')) {
      button.setAttribute(
        'aria-pressed',
        String(button.dataset.auditView === auditDetailMode),
      );
    }
    document.querySelector('#security-audit-expand-all').disabled =
      auditDetailMode !== 'tree';
    document.querySelector('#security-audit-collapse-all').disabled =
      auditDetailMode !== 'tree';
  }

  function closeAuditDetails() {
    const overlay = document.querySelector('#security-audit-detail-overlay');
    overlay.hidden = true;
    document.body.classList.remove('security-modal-open');
    document.querySelector('#security-audit-json-tree').replaceChildren();
    document.querySelector('#security-audit-json-raw').textContent = '';
    auditDetailEntry = null;
  }

  function openAuditDetails(entry) {
    auditDetailEntry = entry;
    const overlay = document.querySelector('#security-audit-detail-overlay');
    const title = document.querySelector('#security-audit-detail-title');
    const meta = document.querySelector('#security-audit-detail-meta');
    const raw = document.querySelector('#security-audit-json-raw');
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
    const tree = document.querySelector('#security-audit-json-tree');
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
    for (const details of document.querySelectorAll(
      '#security-audit-json-tree details.security-json-branch',
    )) {
      details.open = false;
    }
  }

  async function copyAuditJson() {
    if (!auditDetailEntry) return;
    const button = document.querySelector('#security-audit-copy-json');
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
          document.querySelector('#security-audit-message'),
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
          document.querySelector('#security-audit-message'),
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
    const message = document.querySelector('#security-audit-message');
    try {
      const params = auditQuery();
      const payload = await api(`/api/admin/security/audit?${params}`);
      document.querySelector('#security-audit-body').replaceChildren(...payload.entries.map(auditRow));
      document.querySelector('#security-audit-page').textContent = String(Math.floor(auditOffset / auditLimit) + 1);
      document.querySelector('#security-audit-prev').disabled = auditOffset === 0;
      document.querySelector('#security-audit-next').disabled = payload.entries.length < auditLimit;
      document.querySelector('#security-audit-export').href = `/api/admin/security/audit/export.csv?${auditQuery({ exportMode: true })}`;
      setMessage(message, `Показано записей: ${payload.entries.length}`);
    } catch (error) {
      setMessage(message, error.message, 'error');
    }
  }

  async function loadAuditFacets() {
    if (!canViewAudit) return;
    try {
      const facets = await api('/api/admin/security/audit/facets');
      const form = document.querySelector('#security-audit-filter');
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

  document.querySelector('#security-audit-filter')?.addEventListener('submit', (event) => {
    event.preventDefault();
    auditOffset = 0;
    void loadAudit();
  });
  document.querySelector('#security-audit-reset')?.addEventListener('click', () => {
    document.querySelector('#security-audit-filter').reset();
    auditOffset = 0;
    void loadAudit();
  });
  document.querySelector('#security-audit-prev')?.addEventListener('click', () => {
    auditOffset = Math.max(0, auditOffset - auditLimit);
    void loadAudit();
  });
  document.querySelector('#security-audit-next')?.addEventListener('click', () => {
    auditOffset += auditLimit;
    void loadAudit();
  });

  const auditOverlay = document.querySelector('#security-audit-detail-overlay');
  auditOverlay?.querySelector('.security-audit-detail-close')
    ?.addEventListener('click', closeAuditDetails);
  auditOverlay?.addEventListener('click', (event) => {
    if (event.target === auditOverlay) closeAuditDetails();
  });
  document.querySelector('#security-audit-expand-all')
    ?.addEventListener('click', expandAuditJsonTree);
  document.querySelector('#security-audit-collapse-all')
    ?.addEventListener('click', collapseAuditJsonTree);
  document.querySelector('#security-audit-copy-json')
    ?.addEventListener('click', () => void copyAuditJson());
  for (const button of document.querySelectorAll('[data-audit-view]')) {
    button.addEventListener('click', () => setAuditDetailMode(button.dataset.auditView));
  }
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !auditOverlay?.hidden) closeAuditDetails();
  });

  function setMetricsControlsEnabled(enabled) {
    const body = document.querySelector('.security-metrics-body');
    const rotate = document.querySelector('#security-metrics-token-rotate');
    const clear = document.querySelector('#security-metrics-token-clear');

    body?.classList.toggle(
      'is-disabled',
      !enabled,
    );
    body?.setAttribute(
      'aria-disabled',
      String(!enabled),
    );

    if (rotate) {
      rotate.disabled = !enabled;
    }
    if (clear) {
      clear.disabled =
        !enabled ||
        !metricsTokenConfigured;
    }
  }

  function renderMetricsSettings(settings) {
    metricsTokenConfigured = Boolean(settings.metricsTokenConfigured);
    const status = document.querySelector('#security-metrics-token-status');
    const rotate = document.querySelector('#security-metrics-token-rotate');
    const form = document.querySelector('#security-settings-form');
    const enabled = Boolean(
      form?.elements.metricsEnabled?.checked,
    );

    if (status) {
      status.textContent = metricsTokenConfigured
        ? 'Bearer token настроен. Plaintext в базе не хранится.'
        : 'Bearer token не настроен. Сначала сгенерируйте token.';
    }
    if (rotate) {
      rotate.textContent = metricsTokenConfigured
        ? 'Заменить token'
        : 'Сгенерировать token';
    }

    setMetricsControlsEnabled(
      enabled,
    );
  }

  async function loadSettings() {
    if (!canManageSecurity) return;
    const form = document.querySelector('#security-settings-form');
    const message = document.querySelector('#security-settings-status');
    try {
      const payload = await api('/api/admin/security/settings');
      for (const [key, value] of Object.entries(payload.settings)) {
        const control = form.elements[key];
        if (!control) continue;
        if (control.type === 'checkbox') control.checked = Boolean(value);
        else control.value = value;
      }
      renderMetricsSettings(payload.settings);
      bindHumanUnits(document);
      securitySettingsDirty?.markClean();
      setMessage(message, 'Параметры загружены.');
    } catch (error) {
      setMessage(message, error.message, 'error');
    }
  }

  document.querySelector('#security-settings-form')
    ?.elements.metricsEnabled
    ?.addEventListener(
      'change',
      (event) => {
        setMetricsControlsEnabled(
          event.currentTarget.checked,
        );
      },
    );

  document.querySelector('#security-settings-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const numericKeys = [
      'maxFailedAttempts','failureWindowSeconds','lockoutSeconds',
      'ipMaxFailedAttempts','ipFailureWindowSeconds','ipLockoutSeconds',
      'sessionIdleSeconds','sessionAbsoluteSeconds','auditRetentionDays',
      'requestRateLimitUserPerMinute','requestRateLimitGlobalPerMinute',
      'passwordMinLength','passwordMaxLength',
    ];
    const booleanKeys = [
      'passwordRequireLowercase','passwordRequireUppercase',
      'passwordRequireDigit','passwordRequireSpecial',
      'metricsEnabled','mfaRequired',
    ];
    const settings = Object.fromEntries([
      ...numericKeys.map((key) => [key, Number(form.elements[key].value)]),
      ...booleanKeys.map((key) => [key, form.elements[key].checked]),
    ]);
    if (settings.metricsEnabled && !metricsTokenConfigured) {
      setMessage(
        document.querySelector('#security-settings-status'),
        'Сначала сгенерируйте Prometheus bearer token.',
        'error',
      );
      return;
    }
    try {
      const payload = await api('/api/admin/security/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      renderMetricsSettings(payload.settings);
      securitySettingsDirty?.markClean();
      setMessage(document.querySelector('#security-settings-status'), 'Параметры сохранены.', 'success');
    } catch (error) {
      setMessage(document.querySelector('#security-settings-status'), error.message, 'error');
    }
  });

  document.querySelector('#security-metrics-token-rotate')
    ?.addEventListener('click', async () => {
      const confirmed = await adminConfirm({
        title: metricsTokenConfigured
          ? 'Заменить Prometheus token?'
          : 'Сгенерировать Prometheus token?',
        message: metricsTokenConfigured
          ? 'Текущий token перестанет работать сразу после ротации.'
          : 'Новый token будет показан только один раз.',
        confirmLabel: metricsTokenConfigured
          ? 'Заменить token'
          : 'Сгенерировать',
        cancelLabel: 'Отмена',
        destructive: metricsTokenConfigured,
      });
      if (!confirmed) return;

      try {
        const payload = await api('/api/admin/security/metrics-token', {
          method: 'POST',
        });
        renderMetricsSettings(payload.settings);
        showMetricsBearerToken(payload.token);
      } catch (error) {
        setMessage(
          document.querySelector('#security-settings-status'),
          error.message,
          'error',
        );
      }
    });

  document.querySelector('#security-metrics-token-clear')
    ?.addEventListener('click', async () => {
      if (!metricsTokenConfigured) return;
      const confirmed = await adminConfirm({
        title: 'Очистить Prometheus token?',
        message: 'Endpoint /metrics будет выключен, а текущий token перестанет работать.',
        confirmLabel: 'Очистить token',
        cancelLabel: 'Отмена',
        destructive: true,
      });
      if (!confirmed) return;

      try {
        const payload = await api('/api/admin/security/metrics-token', {
          method: 'DELETE',
        });
        const form = document.querySelector('#security-settings-form');
        if (form?.elements.metricsEnabled) {
          form.elements.metricsEnabled.checked = false;
        }
        renderMetricsSettings(payload.settings);
        securitySettingsDirty?.markClean();
        setMessage(
          document.querySelector('#security-settings-status'),
          'Prometheus token очищен; metrics выключены.',
          'success',
        );
      } catch (error) {
        setMessage(
          document.querySelector('#security-settings-status'),
          error.message,
          'error',
        );
      }
    });

  let activeIpBlocks = [];

  function userBlockState(
    user,
  ) {
    const now =
      Date.now();
    const manualActive =
      Boolean(
        user.isBlocked &&
        (
          !user.manualBlockedUntil ||
          new Date(
            user.manualBlockedUntil,
          ).valueOf() >
            now
        ),
      );
    const automaticActive =
      Boolean(
        user.lockedUntil &&
        new Date(
          user.lockedUntil,
        ).valueOf() >
          now,
      );

    return {
      manualActive,
      automaticActive,
    };
  }

  function activeUserBlocks() {
    if (!canManageUsers) {
      return [];
    }

    return [
      ...userById.values(),
    ].filter(
      (user) => {
        const {
          manualActive,
          automaticActive,
        } =
          userBlockState(
            user,
          );

        return (
          manualActive ||
          automaticActive
        );
      },
    );
  }

  function blockFilterValue() {
    return String(
      document.querySelector(
        '#security-block-filter',
      )?.value ??
      '',
    )
      .trim()
      .toLocaleLowerCase(
        'ru-RU',
      );
  }

  function blockRow({
    type,
    object,
    until,
    reason,
    onUnblock,
  }) {
    const row =
      document.createElement(
        'tr',
      );
    const values = [
      type,
      object,
      until,
      reason,
    ];
    for (const value of values) {
      const cell =
        document.createElement(
          'td',
        );
      cell.textContent =
        value || '—';
      row.append(cell);
    }

    const action =
      document.createElement(
        'td',
      );
    const button =
      document.createElement(
        'button',
      );
    button.type =
      'button';
    button.className =
      'secondary';
    button.textContent =
      'Разблокировать';
    button.addEventListener(
      'click',
      () =>
        void onUnblock(),
    );
    action.append(
      button,
    );
    row.append(
      action,
    );
    return row;
  }

  function renderBlockSummary() {
    const body =
      document.querySelector(
        '#security-blocks-body',
      );
    if (!body) return;

    const query =
      blockFilterValue();
    const rows = [];

    for (
      const user of
      activeUserBlocks()
    ) {
      const {
        manualActive,
      } =
        userBlockState(
          user,
        );
      const until =
        manualActive
          ? (
            user.manualBlockedUntil ??
            null
          )
          : (
            user.lockedUntil ??
            null
          );
      const reason =
        manualActive
          ? (
            user.manualBlockReason ??
            'Ручная блокировка пользователя'
          )
          : 'Автоматическая блокировка входа';
      const search =
        [
          'user',
          user.username,
          user.displayName,
          user.email,
          reason,
        ]
          .filter(Boolean)
          .join(' ')
          .toLocaleLowerCase(
            'ru-RU',
          );
      if (
        query &&
        !search.includes(
          query,
        )
      ) {
        continue;
      }

      rows.push(
        blockRow({
          type: 'USER',
          object:
            user.displayName &&
            user.displayName !==
              user.username
              ? user.displayName +
                ' (@' +
                user.username +
                ')'
              : '@' +
                user.username,
          until:
            until
              ? formatDate(
                until,
              )
              : 'бессрочно',
          reason,
          onUnblock:
            async () => {
              try {
                await api(
                  '/api/admin/security/users/' +
                  encodeURIComponent(
                    user.id,
                  ) +
                  '/unblock',
                  {
                    method:
                      'POST',
                  },
                );
                await loadUsers(
                  selectedUserId,
                );
                renderBlockSummary();
              } catch (error) {
                setMessage(
                  document.querySelector(
                    '#security-blocks-message',
                  ),
                  error.message,
                  'error',
                );
              }
            },
        }),
      );
    }

    for (
      const block of
      activeIpBlocks
    ) {
      const search =
        [
          'ip',
          block.ipAddress,
          block.reason,
        ]
          .filter(Boolean)
          .join(' ')
          .toLocaleLowerCase(
            'ru-RU',
          );
      if (
        query &&
        !search.includes(
          query,
        )
      ) {
        continue;
      }

      rows.push(
        blockRow({
          type: 'IP',
          object:
            block.ipAddress,
          until:
            block.expiresAt
              ? formatDate(
                block.expiresAt,
              )
              : 'бессрочно',
          reason:
            block.reason,
          onUnblock:
            async () => {
              try {
                await api(
                  '/api/admin/security/ip-blocks/' +
                  encodeURIComponent(
                    block.id,
                  ),
                  {
                    method:
                      'DELETE',
                  },
                );
                await loadIpBlocks();
              } catch (error) {
                setMessage(
                  document.querySelector(
                    '#security-blocks-message',
                  ),
                  error.message,
                  'error',
                );
              }
            },
        }),
      );
    }

    body.replaceChildren(
      ...rows,
    );
    setMessage(
      document.querySelector(
        '#security-blocks-message',
      ),
      'Активных блокировок: ' +
      rows.length,
    );
  }

  async function loadIpBlocks() {
    if (!canManageSecurity) {
      return;
    }

    try {
      const payload =
        await api(
          '/api/admin/security/ip-blocks',
        );
      activeIpBlocks =
        payload.blocks ?? [];
      setMessage(
        document.querySelector(
          '#security-ip-message',
        ),
        'Активных IP-блокировок: ' +
        activeIpBlocks.length,
      );
      renderBlockSummary();
    } catch (error) {
      setMessage(
        document.querySelector(
          '#security-ip-message',
        ),
        error.message,
        'error',
      );
    }
  }

  document.querySelector(
    '#security-block-filter',
  )?.addEventListener(
    'input',
    renderBlockSummary,
  );

  document.querySelector('#security-ip-block-form')?.addEventListener('submit', async (event) => {
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
      setMessage(document.querySelector('#security-ip-message'), error.message, 'error');
    }
  });

  if (canManageUsers) await loadUsers();
  if (canViewAudit) await loadAuditFacets();

  const securityPrimaryPanel =
    document.querySelector(
      '[data-admin-section-panel="security"]',
    );

  if (
    canManageSecurity &&
    securityPrimaryPanel &&
    !securityPrimaryPanel.hidden
  ) {
    await Promise.all([
      loadSettings(),
      loadIpBlocks(),
    ]);
  }

  window.addEventListener(
    'dtpstat:users-audit-refresh',
    () => {
      if (canManageUsers) {
        void loadUsers(
          selectedUserId,
        );
      }
      if (canViewAudit) {
        void loadAudit();
      }
    },
  );

  window.addEventListener(
    'dtpstat:security-refresh',
    () => {
      if (!canManageSecurity) {
        return;
      }

      void Promise.all([
        loadSettings(),
        loadIpBlocks(),
      ]);
    },
  );
}
