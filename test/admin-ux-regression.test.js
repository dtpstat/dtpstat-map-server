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
    /\.security-ip-block-form[\s\S]*grid-template-columns:\s*minmax\(0,1fr\)/u,
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
