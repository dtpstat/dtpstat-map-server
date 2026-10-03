import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFile(path.join(root, relativePath), 'utf8');

test('admin data and project settings are split into meaningful visual groups', async () => {
  const [html, project, layoutSchema, adminCss, reportCss] = await Promise.all([
    read('admin/index.html'),
    read('admin/project-settings-editor.js'),
    read('admin/admin-layout-schema.js'),
    read('admin/admin.css'),
    read('admin/report-config.css'),
  ]);

  assert.match(html, /<legend>Что загружать<\/legend>/);
  assert.match(html, /<legend>Как и откуда загружать<\/legend>/);
  assert.match(html, /class="export-link"[^>]*>↓ Экспорт GeoJSON<\/a>/);
  assert.match(html, /class="export-link"[^>]*>↓ Экспорт ZIP<\/a>/);
  assert.match(adminCss, /\.osm-config-group/);
  assert.match(adminCss, /\.export-link/);

  assert.doesNotMatch(
    project,
    /data-project-settings-tab="/u,
  );
  assert.match(
    layoutSchema,
    /id:\s*'project'[\s\S]*tabs:[\s\S]*id:\s*'general'[\s\S]*id:\s*'metadata'[\s\S]*id:\s*'footer'/u,
  );
  assert.match(
    project,
    /setupAdminTabGroup\([\s\S]*readState:[\s\S]*readTabState[\s\S]*writeState:[\s\S]*writeTabState/u,
  );
  assert.match(
    layoutSchema,
    /id:\s*'project'[\s\S]*tabs:[\s\S]*stateKey:[\s\S]*'project-settings'/u,
  );
  assert.match(
    layoutSchema,
    /id:\s*'project'[\s\S]*hostId:[\s\S]*'project-settings-editor-host'/u,
  );
  for (
    const hostId of [
      'map-city-category-host',
      'map-display-host',
      'map-history-host',
      'map-city-marker-host',
      'map-actions-host',
    ]
  ) {
    assert.match(
      layoutSchema,
      new RegExp(
        `id:\\s*['"]map['"][\\s\\S]*hostId:[\\s\\S]*['"]${hostId}['"]`,
        'u',
      ),
    );
  }
  assert.doesNotMatch(
    layoutSchema,
    /map-settings-editor-host/u,
  );
  assert.doesNotMatch(
    project,
    /mapTab\.dataset\.interfaceTab|mapPanel\.dataset\.interfacePanel/u,
  );
  assert.match(project, /Сохранить настройки карты/u);
  assert.match(project, /trackDirtyForm\([\s\S]*Настройки проекта \/ карты/u);

  assert.match(reportCss, /\.report-interface-panel[\s\S]*padding:\s*0/);
  assert.match(reportCss, /\.report-interface-panel[\s\S]*border:\s*0/);
  assert.match(reportCss, /\.report-interface-panel[\s\S]*background:\s*transparent/);
});

test('user and profile UX expose avatars password policy and non-blocking session controls', async () => {
  const [security, securityCss, profile, profileCss, securityData] = await Promise.all([
    read('admin/security-editor-v2.js'),
    read('admin/security-v2.css'),
    read('admin/profile-editor.js'),
    read('admin/profile.css'),
    read('src/modules/security/policy.js'),
  ]);

  assert.match(security, /function userListRow\(user\)/);
  assert.match(security, /class="security-user-avatar"/);
  assert.match(security, /if \(user\.hasAvatar\)/);
  assert.match(securityCss, /\.security-user-avatar/);
  assert.match(
    securityCss,
    /#security-panels[\s\S]*display:\s*flex[\s\S]*flex-direction:\s*column/u,
  );
  assert.doesNotMatch(
    securityCss,
    /\.security-settings-grid/u,
  );
  assert.match(
    securityCss,
    /\.security-ip-block-form[\s\S]*grid-template-columns:[\s\S]*15rem[\s\S]*9rem[\s\S]*auto/u,
  );
  assert.match(
    securityCss,
    /@container admin-layout-block \(max-width: 64rem\)[\s\S]*\.security-settings-form fieldset/u,
  );
  assert.match(
    securityCss,
    /@container admin-layout-block \(max-width: 78rem\)[\s\S]*\.security-password-policy-row/u,
  );
  assert.match(
    securityCss,
    /@container admin-layout-block \(max-width: 40rem\)[\s\S]*\.security-metrics-heading/u,
  );
  assert.match(
    securityCss,
    /\.security-audit-block > \.admin-layout-block-host[\s\S]*grid-template-rows:\s*auto auto minmax\(0, 1fr\) auto auto/u,
  );
  assert.match(
    securityCss,
    /@container admin-layout-block \(max-width: 74rem\)[\s\S]*\.security-audit-filter/u,
  );
  assert.match(
    securityCss,
    /@container admin-layout-block \(max-width: 40rem\)[\s\S]*\.security-audit-filter[\s\S]*\.security-section-heading/u,
  );
  assert.doesNotMatch(
    securityCss,
    /@media \(max-width:\s*1180px\)[\s\S]*\.security-audit-filter/u,
  );
  assert.doesNotMatch(
    securityCss,
    /@media \(max-width:\s*1250px\)[\s\S]*\.security-password-policy-row/u,
  );
  assert.match(
    securityCss,
    /@container admin-layout-block \(max-width: 62rem\)[\s\S]*\.security-master-detail[\s\S]*\.security-users-master[\s\S]*\.security-user-detail/u,
  );
  assert.match(
    securityCss,
    /@container admin-layout-block \(max-width: 40rem\)[\s\S]*\.security-detail-fields[\s\S]*\.security-role-grid[\s\S]*\.security-inline-block-form[\s\S]*\.security-user-detail-heading/u,
  );
  assert.doesNotMatch(
    securityCss,
    /@media \(max-width:\s*1000px\)[\s\S]*\.security-master-detail/u,
  );

  assert.match(
    securityCss,
    /#security-settings-panels[\s\S]*flex:\s*1 1 auto/u,
  );
  assert.match(
    securityCss,
    /\.security-blocks-layout[\s\S]*grid-template-columns:[\s\S]*\.72fr[\s\S]*1\.28fr/u,
  );
  assert.match(
    securityCss,
    /\.security-block-policy fieldset input\[type="number"\][\s\S]*width:\s*14ch/u,
  );
  assert.match(
    securityCss,
    /@container admin-layout-block \(max-width: 66rem\)[\s\S]*\.security-blocks-layout[\s\S]*grid-template-columns:\s*1fr/u,
  );
  assert.match(
    security,
    /security-ip-block-search[\s\S]*data-ip-block-sort="ip"[\s\S]*data-ip-block-sort="remaining"/u,
  );
  assert.match(
    security,
    /security-ip-allowlist-form[\s\S]*192\.168\.0\.0\/24/u,
  );
  assert.match(
    security,
    /systemIpAllowlist[\s\S]*127\.0\.0\.1\/24[\s\S]*Системный loopback/u,
  );
  assert.match(
    security,
    /security-ip-allowlist-system-badge[\s\S]*Не удаляется/u,
  );
  assert.match(
    securityCss,
    /\.security-ip-allowlist-system-badge/u,
  );
  assert.match(
    securityCss,
    /\.security-ip-allowlist-form[\s\S]*grid-template-columns:[\s\S]*13rem[\s\S]*auto/u,
  );
  assert.match(
    security,
    /left\.append\([\s\S]*allowlist/u,
  );
  assert.match(
    security,
    /security-ip-allowlist-preview/u,
  );
  assert.match(
    security,
    /function parseIpNetwork\([\s\S]*function ipMatchesNetwork\([\s\S]*activeIpBlocks\.filter/u,
  );
  assert.match(
    security,
    /Диапазон:[\s\S]*активных ручных блокировок будет снято/u,
  );
  assert.match(
    security,
    /function validIpv4Address\([\s\S]*function validIpv6Address\([\s\S]*validateIpInput/u,
  );
  assert.match(
    security,
    /security-user-blocked-filter[\s\S]*aria-pressed/u,
  );
  assert.match(
    security,
    /userCurrentlyBlocked[\s\S]*security-user-row-lock/u,
  );
  assert.doesNotMatch(
    security,
    /Заблокированные пользователи/u,
  );
  assert.match(securityCss, /\.security-audit-filter-panel/);
  assert.match(securityCss, /\.security-audit-filter[\s\S]*grid-template-columns:\s*repeat\(4/);
  assert.match(profile, /profile-avatar-upload-label/);
  assert.match(profile, /id="profile-avatar-delete" disabled/);
  assert.match(profileCss, /\.profile-avatar-actions[\s\S]*grid-template-columns:\s*repeat\(2/);
  assert.match(profileCss, /\.profile-avatar-action/);
  assert.match(
    profileCss,
    /@container admin-layout-block \(max-width: 52rem\)/u,
  );
  assert.doesNotMatch(
    profileCss,
    /@media \(max-width:\s*850px\)/u,
  );
  assert.match(
    profile,
    /\[data-admin-section-panel="profile"\]/u,
  );
  for (
    const hostId of [
      'profile-account-host',
      'profile-password-host',
      'profile-mfa-host',
      'profile-sessions-host',
    ]
  ) {
    assert.match(
      profile,
      new RegExp(
        `#${hostId}`,
        'u',
      ),
    );
  }
  assert.doesNotMatch(
    profile,
    /profile-grid|profile-editor-host/u,
  );
  assert.doesNotMatch(
    profileCss,
    /profile-grid|#profile-editor-host/u,
  );

  assert.match(security, /name="passwordMinLength"/);
  assert.match(security, /name="passwordMaxLength" type="hidden"/);
  assert.doesNotMatch(security, />Максимум символов</);
  assert.match(security, /name="passwordRequireLowercase"/);
  assert.match(security, /name="passwordRequireUppercase"/);
  assert.match(security, /name="passwordRequireDigit"/);
  assert.match(security, /name="passwordRequireSpecial"/);
  assert.match(securityData, /DEFAULT_ADMIN_PASSWORD_POLICY/);
  assert.match(securityData, /passwordRequireSpecial/);

  assert.match(profile, /\/api\/admin\/profile\/password-policy/);
  assert.match(profile, /id="profile-password-policy"/);
  assert.match(profile, /adminConfirm\(/);
  assert.doesNotMatch(profile, /window\.confirm\(/);
  assert.doesNotMatch(profile, /id="profile-confirm-overlay"/);
  assert.match(profile, /class="danger" id="profile-revoke-others"/);
  assert.match(profileCss, /\.profile-session \.danger/);
  assert.doesNotMatch(profileCss, /\.profile-confirm-overlay/);
});


test('desktop admin layout minimizes nested scrolling and exposes compact empty states', async () => {
  const [
    adminCss,
    projectCss,
    profile,
    profileCss,
    security,
    securityCss,
    messagesCss,
  ] =
    await Promise.all([
      read(
        'admin/admin.css',
      ),
      read(
        'admin/project-settings.css',
      ),
      read(
        'admin/profile-editor.js',
      ),
      read(
        'admin/profile.css',
      ),
      read(
        'admin/security-editor-v2.js',
      ),
      read(
        'admin/security-v2.css',
      ),
      read(
        'admin/discussion-inbox.css',
      ),
    ]);

  assert.match(
    adminCss,
    /body\s*\{[\s\S]*height:\s*100dvh[\s\S]*grid-template-rows:[\s\S]*minmax\(0, 1fr\)[\s\S]*overflow:\s*hidden/u,
  );
  assert.match(
    adminCss,
    /\.admin-layout\s*\{[\s\S]*height:\s*100%[\s\S]*min-height:\s*0/u,
  );
  assert.match(
    adminCss,
    /@media \(max-width: 1050px\)[\s\S]*body[\s\S]*overflow:\s*auto/u,
  );
  assert.match(
    adminCss,
    /\.portable-kml-transfer[\s\S]*#line-kml-transfer-form[\s\S]*grid-template-columns:[\s\S]*auto/u,
  );

  assert.match(
    projectCss,
    /\[data-interface-panel="map"\][\s\S]*overflow-y:\s*auto/u,
  );
  assert.match(
    projectCss,
    /admin-layout-grid[\s\S]*grid-auto-rows:\s*max-content/u,
  );
  assert.match(
    projectCss,
    /map-actions[\s\S]*grid-column:\s*1 \/ -1/u,
  );

  assert.match(
    profile,
    /profile-tabs[\s\S]*Профиль[\s\S]*Пароль и MFA[\s\S]*Сессии/u,
  );
  assert.match(
    profile,
    /selectProfileTab/u,
  );
  assert.match(
    profileCss,
    /\.profile-tabs[\s\S]*repeat\(3/u,
  );
  assert.match(
    profileCss,
    /#profile-sessions[\s\S]*overflow-y:\s*auto/u,
  );

  assert.doesNotMatch(
    security,
    /Блок\. учётку|Блок\. IP/u,
  );
  assert.match(
    security,
    /security-ip-block-pagination/u,
  );
  assert.match(
    security,
    /IP_BLOCK_PAGE_SIZE = 12/u,
  );
  assert.match(
    security,
    /pageItems =[\s\S]*\.slice\(/u,
  );
  assert.match(
    securityCss,
    /\.security-blocks-column-ip[\s\S]*minmax\(0, 1fr\)/u,
  );
  assert.match(
    securityCss,
    /\.security-ip-block-pagination/u,
  );
  assert.match(
    securityCss,
    /\.security-detail-fields[\s\S]*grid-template-columns:[\s\S]*3/u,
  );
  assert.match(
    securityCss,
    /\.security-role-grid[\s\S]*repeat\(3/u,
  );
  assert.match(
    security,
    /validateEmail[\s\S]*typeMismatch[\s\S]*Формат корректен/u,
  );

  assert.match(
    messagesCss,
    /\.profile-discussion-thread > \.empty-state[\s\S]*font-size:\s*1rem[\s\S]*text-align:\s*center/u,
  );
  assert.match(
    messagesCss,
    /\.admin-messages-section \.settings-card[\s\S]*height:\s*100%/u,
  );
});
