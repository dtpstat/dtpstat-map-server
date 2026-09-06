function canManageData(user) {
  return Boolean(user?.isSuperuser || user?.canManageData);
}

function canManageInterface(user) {
  return Boolean(user?.isSuperuser || user?.canManageInterface);
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
    reportPanel.setAttribute('aria-labelledby', 'interface-tab-report');
    document.querySelector('#interface-panels')?.append(reportPanel);
  }

  const projectTab = document.querySelector('[data-interface-tab="project"]');
  const projectPanel = document.querySelector('[data-interface-panel="project"]');
  const lineTypesTab = document.querySelector('[data-interface-tab="line-types"]');
  const lineTypesPanel = document.querySelector('[data-interface-panel="line-types"]');
  const tabs = document.querySelector('#interface-tabs');
  const panels = document.querySelector('#interface-panels');

  for (const node of [projectTab, reportTab, lineTypesTab]) {
    if (node) tabs?.append(node);
  }
  for (const node of [projectPanel, reportPanel, lineTypesPanel]) {
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
    for (const panel of panels) {
      panel.hidden = panel.dataset.interfacePanel !== key;
    }
    if (key === 'line-types') {
      window.dispatchEvent(new CustomEvent('dtpstat:line-types-changed'));
    }
  };

  for (const tab of tabs) {
    tab.addEventListener('click', () => select(tab.dataset.interfaceTab));
  }
  select(
    tabs.find((tab) => tab.dataset.interfaceTab === 'project')?.dataset.interfaceTab
      ?? tabs[0].dataset.interfaceTab,
  );
}

async function loadInterfaceEditors() {
  await import('./project-settings-editor.js');
  await import('./line-types-editor.js');

  // report-config-editor.js predates the top-level admin split. At this point
  // admin.js has already captured only the data-management controls. Expose the
  // interface hosts under the old selectors just for module initialization.
  const interfaceTabs = document.querySelector('#interface-tabs');
  const interfaceCard = document.querySelector('#interface-card');
  interfaceTabs?.classList.add('task-tabs');
  interfaceCard?.classList.add('control-card');
  try {
    await import('./report-config-editor.js');
  } finally {
    interfaceTabs?.classList.remove('task-tabs');
    interfaceCard?.classList.remove('control-card');
  }
  normalizeInterfaceEditorNodes();
  setupInterfaceTabs();
}

function setupDataSectionLockExtensions() {
  const status = document.querySelector('#task-status');
  const dataSection = document.querySelector('#admin-section-data');
  if (!status || !dataSection) return;

  const exportLinks = () => [
    ...dataSection.querySelectorAll('a[href^="/api/admin/export/"]'),
  ];
  const activeClasses = new Set([
    'status-running',
    'status-queued',
    'status-cancelling',
  ]);
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
  // Insert portable-KML controls before admin.js snapshots all data forms so
  // the same single-task lock covers them as well.
  await import('./kml-transfer-editor.js');
  await import('./admin.js');
  setupDataSectionLockExtensions();
}

function setupPrimarySections(user) {
  const permissions = {
    data: canManageData(user),
    interface: canManageInterface(user),
    security: Boolean(user?.isSuperuser),
  };
  const tabs = [...document.querySelectorAll('[data-admin-section-tab]')];
  const panels = [...document.querySelectorAll('[data-admin-section-panel]')];
  const connection = document.querySelector('#connection-state');

  for (const tab of tabs) {
    const key = tab.dataset.adminSectionTab;
    tab.hidden = !permissions[key];
  }

  const available = ['data', 'interface', 'security'].filter((key) => permissions[key]);
  if (available.length === 0) return;

  const select = (key) => {
    if (!permissions[key]) return;
    for (const tab of tabs) {
      const active = tab.dataset.adminSectionTab === key;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    }
    for (const panel of panels) {
      panel.hidden = panel.dataset.adminSectionPanel !== key;
    }
    if (connection) connection.hidden = key !== 'data' || !permissions.data;
    if (key === 'security') {
      window.dispatchEvent(new CustomEvent('dtpstat:security-refresh'));
    }
  };

  for (const tab of tabs) {
    tab.addEventListener('click', () => select(tab.dataset.adminSectionTab));
  }
  select(available[0]);
}

async function startAdminShell() {
  const userBadge = document.querySelector('#admin-user');
  try {
    const session = await globalThis.dtpstatAdminSession;
    const user = session.user;
    if (userBadge) {
      const roles = [
        user.isSuperuser ? 'superuser' : null,
        user.canManageData ? 'данные' : null,
        user.canManageInterface ? 'интерфейс' : null,
      ].filter(Boolean).join(' · ');
      userBadge.textContent = `${user.username}${roles ? ` — ${roles}` : ''}`;
    }

    setupPrimarySections(user);

    // Order is deliberate: the legacy data controller snapshots its controls
    // first. Interface editors are loaded afterwards and therefore remain fully
    // usable while a long-running data task is active.
    if (canManageData(user)) await loadDataEditors();
    if (canManageInterface(user)) await loadInterfaceEditors();
    if (user.isSuperuser) await import('./security-editor.js');
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
