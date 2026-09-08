function canManageData(user) {
  return Boolean(user?.isSuperuser || user?.canManageData);
}

function canManageInterface(user) {
  return Boolean(user?.isSuperuser || user?.canManageInterface);
}

function canAccessSecurity(user) {
  return Boolean(
    user?.isSuperuser || user?.canManageUsers || user?.canViewAudit || user?.canManageSecurity,
  );
}

function ensureProfileSection() {
  const tabsHost = document.querySelector('#admin-primary-tabs');
  const sectionsHost = document.querySelector('.admin-sections');
  if (!tabsHost || !sectionsHost) return;

  if (!document.querySelector('[data-admin-section-tab="profile"]')) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.role = 'tab';
    tab.dataset.adminSectionTab = 'profile';
    tab.setAttribute('aria-selected', 'false');
    tab.setAttribute('aria-controls', 'admin-section-profile');
    tab.textContent = 'Профиль';
    tabsHost.append(tab);
  }

  if (!document.querySelector('[data-admin-section-panel="profile"]')) {
    const section = document.createElement('section');
    section.className = 'admin-section-panel';
    section.id = 'admin-section-profile';
    section.dataset.adminSectionPanel = 'profile';
    section.role = 'tabpanel';
    section.hidden = true;
    section.innerHTML = `
      <div class="admin-layout admin-layout-single">
        <section class="settings-card" aria-labelledby="profile-title">
          <div class="section-heading">
            <div>
              <p class="eyebrow">АКТИВНАЯ УЧЁТНАЯ ЗАПИСЬ</p>
              <h2 id="profile-title">Профиль</h2>
            </div>
          </div>
          <div id="profile-editor-host"><p class="empty-state">Загружаем профиль…</p></div>
        </section>
      </div>
    `;
    sectionsHost.append(section);
  }
}

function clearBasicAuthCache() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    try {
      const request = new XMLHttpRequest();
      request.open(
        'GET',
        `/admin/logout-basic.txt?_=${Date.now()}`,
        true,
        'sim',
        'salabim',
      );
      request.setRequestHeader('Cache-Control', 'no-store');
      request.onloadend = finish;
      request.onerror = finish;
      request.ontimeout = finish;
      request.timeout = 2500;
      request.send();
    } catch {
      finish();
    }

    window.setTimeout(finish, 3000);
  });
}

function ensureTopbarActions() {
  const host = document.querySelector('.topbar-status');
  if (!host || document.querySelector('#admin-logout')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'admin-logout';
  button.className = 'secondary';
  button.textContent = 'Выйти';
  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = 'Выходим…';
    try {
      await fetch('/api/admin/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
    } catch {
      // Continue with browser Basic Auth cache replacement even when the
      // server-side session has already expired or the network reply was lost.
    }
    await clearBasicAuthCache();
    window.location.replace('/admin/login.html');
  });
  host.append(button);
}

function normalizeInterfaceEditorNodes() {
  const reportTab = document.querySelector('[data-task-tab="report"]');
  const reportPanel = document.querySelector('[data-task-panel="report"]');
  if (reportTab) {
    delete reportTab.dataset.taskTab;
    reportTab.dataset.interfaceTab = 'report';
    reportTab.id = 'interface-tab-report';
    reportTab.setAttribute('aria-controls', 'interface-panel-report');
  }
  if (reportPanel) {
    delete reportPanel.dataset.taskPanel;
    reportPanel.dataset.interfacePanel = 'report';
    reportPanel.id = 'interface-panel-report';
    reportPanel.classList.add('interface-task-panel', 'report-interface-panel');
    reportPanel.setAttribute('aria-labelledby', 'interface-tab-report');

    // The report editor originated as a data-task panel. Once mounted under
    // interface settings, remove the legacy form/scroll hooks so it is governed
    // only by the interface role and by the outer interface panel scroller.
    reportPanel.querySelector('#report-config-form')?.removeAttribute('data-task-form');
    reportPanel.querySelector('.report-config-sections')?.classList.remove('form-fields');
    document.querySelector('#interface-panels')?.append(reportPanel);
  }

  const projectTab = document.querySelector('[data-interface-tab="project"]');
  const projectPanel = document.querySelector('[data-interface-panel="project"]');
  const lineTypesTab = document.querySelector('[data-interface-tab="line-types"]');
  const lineTypesPanel = document.querySelector('[data-interface-panel="line-types"]');
  const transferTab = document.querySelector('[data-interface-tab="project-transfer"]');
  const transferPanel = document.querySelector('[data-interface-panel="project-transfer"]');
  const tabs = document.querySelector('#interface-tabs');
  const panels = document.querySelector('#interface-panels');

  for (const node of [projectTab, reportTab, lineTypesTab, transferTab]) {
    if (node) tabs?.append(node);
  }
  for (const node of [projectPanel, reportPanel, lineTypesPanel, transferPanel]) {
    if (node) panels?.append(node);
  }
}

function setupInterfaceTabs() {
  const tabs = [...document.querySelectorAll('[data-interface-tab]')];
  const panels = [...document.querySelectorAll('[data-interface-panel]')];
  if (tabs.length === 0) return;

  const select = (key) => {
    for (const tab of tabs) {
      const active = tab.dataset.interfaceTab === key;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    }
    for (const panel of panels) panel.hidden = panel.dataset.interfacePanel !== key;
    if (key === 'line-types') {
      window.dispatchEvent(new CustomEvent('dtpstat:line-types-changed'));
    }
  };

  for (const tab of tabs) tab.addEventListener('click', () => select(tab.dataset.interfaceTab));
  select(
    tabs.find((tab) => tab.dataset.interfaceTab === 'project')?.dataset.interfaceTab
      ?? tabs[0].dataset.interfaceTab,
  );
}

async function loadInterfaceEditors(user) {
  await import('./project-settings-editor.js');
  await import('./public-download-name-editor.js');
  await import('./line-types-editor.js');

  // Compatibility bootstrap for the legacy report module only. The temporary
  // classes are removed immediately and normalizeInterfaceEditorNodes() strips
  // every remaining data-task marker before the editor becomes visible.
  const interfaceTabs = document.querySelector('#interface-tabs');
  const interfaceCard = document.querySelector('#interface-card');
  interfaceTabs?.classList.add('task-tabs');
  interfaceCard?.classList.add('control-card');
  try {
    await import('./report-config-editor.js');
    await import('./report-range-ui.js');
  } finally {
    interfaceTabs?.classList.remove('task-tabs');
    interfaceCard?.classList.remove('control-card');
  }
  if (user.isSuperuser) await import('./project-transfer-editor.js');
  normalizeInterfaceEditorNodes();
  setupInterfaceTabs();
}

function setupDataSectionLockExtensions() {
  const status = document.querySelector('#task-status');
  const dataSection = document.querySelector('#admin-section-data');
  if (!status || !dataSection) return;

  const exportLinks = () => [...dataSection.querySelectorAll('a[href^="/api/admin/export/"]')];
  const activeClasses = new Set(['status-running', 'status-queued', 'status-cancelling']);
  const sync = () => {
    const locked = [...activeClasses].some((className) => status.classList.contains(className));
    for (const link of exportLinks()) {
      link.classList.toggle('is-disabled', locked);
      link.setAttribute('aria-disabled', String(locked));
      link.tabIndex = locked ? -1 : 0;
    }
  };

  dataSection.addEventListener('click', (event) => {
    const link = event.target.closest('a[aria-disabled="true"]');
    if (!link) return;
    event.preventDefault();
  });
  new MutationObserver(sync).observe(status, {
    attributes: true,
    attributeFilter: ['class'],
    childList: true,
  });
  sync();
}

async function loadDataEditors() {
  await import('./json-examples.js');
  await import('./kml-transfer-editor.js');
  await import('./admin.js');
  setupDataSectionLockExtensions();
}

function setupPrimarySections(user) {
  const mustChangePassword = Boolean(user.mustChangePassword);
  const permissions = {
    data: !mustChangePassword && canManageData(user),
    interface: !mustChangePassword && canManageInterface(user),
    security: !mustChangePassword && canAccessSecurity(user),
    profile: true,
  };
  const tabs = [...document.querySelectorAll('[data-admin-section-tab]')];
  const panels = [...document.querySelectorAll('[data-admin-section-panel]')];
  const connection = document.querySelector('#connection-state');

  for (const tab of tabs) {
    const key = tab.dataset.adminSectionTab;
    tab.hidden = !permissions[key];
  }

  const available = ['data', 'interface', 'security', 'profile'].filter((key) => permissions[key]);
  const select = (key) => {
    if (!permissions[key]) return;
    for (const tab of tabs) {
      const active = tab.dataset.adminSectionTab === key;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    }
    for (const panel of panels) panel.hidden = panel.dataset.adminSectionPanel !== key;
    if (connection) connection.hidden = key !== 'data' || !permissions.data;
    if (key === 'security') window.dispatchEvent(new CustomEvent('dtpstat:security-refresh'));
  };

  for (const tab of tabs) tab.addEventListener('click', () => select(tab.dataset.adminSectionTab));
  select(mustChangePassword ? 'profile' : available[0]);
  return { select };
}

function updateUserBadge(user) {
  const badge = document.querySelector('#admin-user');
  if (!badge) return;
  const roles = [
    user.isSuperuser ? 'superuser' : null,
    user.canManageData ? 'данные' : null,
    user.canManageInterface ? 'интерфейс' : null,
    user.canManageUsers ? 'пользователи' : null,
    user.canViewAudit ? 'аудит' : null,
    user.canManageSecurity ? 'безопасность' : null,
  ].filter(Boolean).join(' · ');
  badge.textContent = `${user.displayName ?? user.username}${roles ? ` — ${roles}` : ''}`;
}

async function startAdminShell() {
  const userBadge = document.querySelector('#admin-user');
  try {
    await import('./action-feedback.js');
    await import('./project-branding.js');
    const session = await globalThis.dtpstatAdminSession;
    const user = session.user;
    ensureProfileSection();
    ensureTopbarActions();
    updateUserBadge(user);
    setupPrimarySections(user);

    await import('./profile-editor.js');
    if (!user.mustChangePassword) {
      if (canManageData(user)) await loadDataEditors();
      if (canManageInterface(user)) await loadInterfaceEditors(user);
      if (canAccessSecurity(user)) await import('./security-editor-v2.js');
    }

    window.addEventListener('dtpstat:admin-session-changed', (event) => updateUserBadge(event.detail.user));
    window.addEventListener('dtpstat:password-changed', () => window.location.reload());
  } catch (error) {
    if (userBadge) userBadge.textContent = 'Ошибка авторизации';
    const host = document.querySelector('#security-editor-host');
    if (host) {
      host.innerHTML = '';
      const message = document.createElement('p');
      message.className = 'notice notice-error';
      message.textContent = error.message ?? 'Не удалось загрузить административную сессию';
      host.append(message);
    }
  }
}

await startAdminShell();
