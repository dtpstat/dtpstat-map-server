import { adminAvatarObjectUrl } from './admin-avatar.js';
import {
  ensureAdminSections,
  ensureAdminTabPanels,
  setupAdminTabs,
} from './admin-layout.js';
import {
  adminDynamicSections,
  adminInterfaceTabs,
} from './admin-layout-schema.js';
import { confirmDirtyNavigation, installDirtyTabGuard } from './admin-dirty-state.js';
import { readTabState, writeTabState } from './admin-tab-state.js';
import {
  hidePageStandby,
  showPageStandby,
} from '../js/page-standby.js';

function canManageData(user) {
  return Boolean(user?.isSuperuser || user?.canManageData);
}

function canManageInterface(user) {
  return Boolean(user?.isSuperuser || user?.canManageInterface);
}

function canEditOsm(user) {
  return Boolean(user?.isSuperuser || user?.canEditOsm);
}

function canEditGeometries(user) {
  return Boolean(user?.isSuperuser || user?.canEditGeometries);
}

function canAccessUsersAudit(user) {
  return Boolean(
    user?.isSuperuser ||
    user?.canManageUsers ||
    user?.canViewAudit,
  );
}

function canAccessSecurity(user) {
  return Boolean(
    canAccessUsersAudit(user) ||
    user?.canManageSecurity,
  );
}

function canManageSecuritySettings(user) {
  return Boolean(
    user?.isSuperuser ||
    user?.canManageSecurity,
  );
}

function permissionFingerprint(
  user,
  mfaRequired = false,
) {
  return [
    Boolean(user?.isSuperuser),
    Boolean(user?.mustChangePassword),
    Boolean(mfaRequired),
    Boolean(user?.mfaEnabled),
    Boolean(user?.canManageData),
    Boolean(user?.canEditGeometries),
    Boolean(user?.canEditOsm),
    Boolean(user?.canManageInterface),
    Boolean(user?.canManageUsers),
    Boolean(user?.canViewAudit),
    Boolean(user?.canManageSecurity),
  ].join(':');
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
    if (!await confirmDirtyNavigation({
      title: 'Выйти из админки?',
      message: 'Есть несохранённые изменения. При выходе они будут потеряны.',
    })) return;
    button.disabled = true;
    button.textContent = 'Выходим…';
    showPageStandby(
      'Выходим из админки…',
    );
    try {
      await fetch('/api/admin/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
    } catch {
      // The local session may already be expired or the network reply lost.
    }
    window.location.replace('/admin/login.html');
  });
  host.append(button);
}

async function loadInterfaceEditors(user) {
  ensureAdminTabPanels({
    tabsHost:
      document.querySelector(
        '#interface-tabs',
      ),
    panelsHost:
      document.querySelector(
        '#interface-panels',
      ),
    definitions:
      adminInterfaceTabs,
    user,
  });

  await import('./project-settings-editor.js');
  await import('./public-download-name-editor.js');
  await import('./line-types-editor.js');
  await import('./point-types-editor.js');

  await import('./report-config-editor.js');
  await import('./report-range-ui.js');
  if (user.isSuperuser) {
    await import(
      './project-transfer-editor.js'
    );
  }


  setupAdminTabs({
    tabsHost:
      document.querySelector(
        '#interface-tabs',
      ),
    panelsHost:
      document.querySelector(
        '#interface-panels',
      ),
    definitions:
      adminInterfaceTabs,
    user,
    readState:
      readTabState,
    writeState:
      writeTabState,
    stateKey:
      'interface',
    defaultId:
      'project',
  });
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

function setupPrimarySections(
  user,
  {
    mfaRequired = false,
  } = {},
) {
  const mustChangePassword =
    Boolean(
      user.mustChangePassword,
    );
  const mustEnrollMfa =
    Boolean(
      mfaRequired &&
      !user.mfaEnabled,
    );
  const restricted =
    mustChangePassword ||
    mustEnrollMfa;
  const dataAccess =
    !restricted &&
    canManageData(user);
  const permissions = {
    data: dataAccess,
    geometries: !restricted && canEditGeometries(user),
    'osm-objects': !restricted && canEditOsm(user),
    interface: !restricted && canManageInterface(user),
    'users-audit':
      !restricted &&
      canAccessUsersAudit(user),
    security:
      !restricted &&
      canManageSecuritySettings(user),
    messages:
      !restricted &&
      (
        canEditGeometries(user) ||
        canEditOsm(user)
      ),
    profile: true,
  };
  const tabs = [...document.querySelectorAll('[data-admin-section-tab]')];
  const panels = [...document.querySelectorAll('[data-admin-section-panel]')];
  const connection = document.querySelector('#connection-state');

  for (const tab of tabs) {
    const key = tab.dataset.adminSectionTab;
    tab.hidden = !permissions[key];
  }

  const available = [
    'data',
    'geometries',
    'osm-objects',
    'interface',
    'users-audit',
    'security',
    'messages',
    'profile',
  ].filter(
    (key) => permissions[key],
  );
  const select = (key) => {
    if (!permissions[key]) return;
    writeTabState('primary', key);
    for (const tab of tabs) {
      const active = tab.dataset.adminSectionTab === key;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    }
    for (const panel of panels) panel.hidden = panel.dataset.adminSectionPanel !== key;
    if (connection) {
      connection.hidden = !['data', 'geometries', 'osm-objects'].includes(key);
    }
    if (
      key === 'users-audit' ||
      key === 'security'
    ) {
      window.dispatchEvent(
        new CustomEvent(
          'dtpstat:security-refresh',
        ),
      );
    }
    if (key === 'geometries') {
      window.dispatchEvent(new CustomEvent('dtpstat:geometry-editor-open'));
    }
    if (key === 'osm-objects') {
      window.dispatchEvent(new CustomEvent('dtpstat:osm-boundary-editor-open'));
    }
    if (key === 'messages') {
      window.dispatchEvent(
        new CustomEvent(
          'dtpstat:messages-open',
        ),
      );
    }
    if (key === 'profile') {
      window.dispatchEvent(new CustomEvent('dtpstat:profile-open'));
    }
  };

  for (const tab of tabs) tab.addEventListener('click', () => select(tab.dataset.adminSectionTab));
  const initial = restricted
    ? 'profile'
    : readTabState('primary', available, available[0]);
  select(initial);
  return { select };
}

let userBadgeAvatarRequestSequence = 0;

function updateUserBadge(user) {
  const badge = document.querySelector('#admin-user');
  const label = document.querySelector('#admin-user-label');
  const rolesHost = document.querySelector('#admin-user-roles');
  const image = document.querySelector('#admin-user-avatar-image');
  const fallback = document.querySelector('#admin-user-avatar-fallback');
  if (!badge || !label || !rolesHost || !image || !fallback) return;

  const roles = [
    user.isSuperuser ? 'superuser' : null,
    user.canManageData ? 'данные' : null,
    user.canEditGeometries ? 'геометрии' : null,
    user.canEditOsm ? 'OSM' : null,
    user.canManageInterface ? 'интерфейс' : null,
    user.canManageUsers ? 'пользователи' : null,
    user.canViewAudit ? 'аудит' : null,
    user.canManageSecurity ? 'безопасность' : null,
  ].filter(Boolean);

  label.textContent = user.displayName ?? user.username;
  rolesHost.replaceChildren(...roles.map((role) => {
    const tag = document.createElement('span');
    tag.className = 'admin-user-role';
    tag.textContent = role;
    return tag;
  }));
  rolesHost.hidden = roles.length === 0;

  fallback.textContent = String(
    user.displayName ?? user.username ?? '?',
  ).trim().slice(0, 1).toLocaleUpperCase('ru-RU') || '?';

  const requestSequence =
    ++userBadgeAvatarRequestSequence;

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
          userBadgeAvatarRequestSequence
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
          userBadgeAvatarRequestSequence
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


async function startAdminShell() {
  const userBadge = document.querySelector('#admin-user');
  try {
    await import('./action-feedback.js');
    await import('./project-branding.js');
    const session = await globalThis.dtpstatAdminSession;
    const user = session.user;
    const {
      startAdminRealtime,
    } = await import('./realtime-client.js');
    startAdminRealtime();
    ensureAdminSections({
      tabsHost:
        document.querySelector(
          '#admin-primary-tabs',
        ),
      sectionsHost:
        document.querySelector(
          '.admin-sections',
        ),
      sections:
        adminDynamicSections,
    });
    ensureTopbarActions();
    updateUserBadge(user);
    setupPrimarySections(
      user,
      {
        mfaRequired:
          session.mfaRequired,
      },
    );

    await import('./profile-editor.js');
    await import('./discussion-inbox.js');
    const restricted =
      Boolean(
        user.mustChangePassword ||
        (
          session.mfaRequired &&
          !user.mfaEnabled
        ),
      );
    if (!restricted) {
      if (canManageData(user)) await loadDataEditors();
      if (canEditGeometries(user)) await import('./geometry-editor.js');
      if (canEditOsm(user)) await import('./osm-boundary-editor.js');
      if (canManageInterface(user)) await loadInterfaceEditors(user);
      if (canAccessSecurity(user)) await import('./security-editor-v2.js');
    }

    let activePermissionFingerprint =
      permissionFingerprint(
        user,
        session.mfaRequired,
      );

    window.addEventListener(
      'dtpstat:admin-session-changed',
      (event) => {
        const nextUser =
          event.detail?.user;
        if (!nextUser) return;

        updateUserBadge(
          nextUser,
        );

        const nextFingerprint =
          permissionFingerprint(
            nextUser,
            event.detail
              ?.mfaRequired,
          );
        if (
          nextFingerprint !==
          activePermissionFingerprint
        ) {
          activePermissionFingerprint =
            nextFingerprint;
          showPageStandby(
            'Обновляем доступ…',
          );
          window.location.reload();
        }
      },
    );
    window.addEventListener(
      'dtpstat:password-changed',
      () => {
        showPageStandby(
          'Обновляем сессию…',
        );
        window.location.reload();
      },
    );
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
  } finally {
    hidePageStandby();
  }
}

await startAdminShell();

installDirtyTabGuard();
