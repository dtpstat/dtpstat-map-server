import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const adminRoot = path.join(root, 'admin');
const read = (relativePath) => fs.readFile(path.join(root, relativePath), 'utf8');

test('admin uses shared non-blocking dialogs and no browser-native modal APIs', async () => {
  const files = (await fs.readdir(adminRoot)).filter((name) => name.endsWith('.js'));
  const nativeDialog = /\b(?:window\.)?(?:confirm|alert|prompt)\s*\(/;
  for (const file of files) {
    const source = await fs.readFile(path.join(adminRoot, file), 'utf8');
    assert.doesNotMatch(source, nativeDialog, `${file} must not use a browser-native modal API`);
    assert.doesNotMatch(source, /beforeunload/, `${file} must not trigger a browser-native leave-page prompt`);
  }

  const [dialog, css] = await Promise.all([
    read('admin/admin-dialog.js'),
    read('admin/admin.css'),
  ]);
  assert.match(dialog, /export function adminConfirm/);
  assert.match(dialog, /export function adminAlert/);
  assert.match(dialog, /className = 'admin-dialog-overlay'/);
  assert.match(dialog, /dialogQueue/);
  assert.match(css, /\.admin-dialog-overlay/);
  assert.match(css, /body\.admin-dialog-open/);
});

test('dirty settings are guarded by one shared service', async () => {
  const [dirty, shell, project, report, lineTypes, downloadName, security, data] =
    await Promise.all([
      read('admin/admin-dirty-state.js'),
      read('admin/admin-shell.js'),
      read('admin/project-settings-editor.js'),
      read('admin/report-config-editor.js'),
      read('admin/line-types-editor.js'),
      read('admin/public-download-name-editor.js'),
      read('admin/security-editor-v2.js'),
      read('admin/admin.js'),
    ]);

  assert.match(dirty, /export function trackDirtyForm/);
  assert.match(dirty, /export function installDirtyTabGuard/);
  assert.match(dirty, /adminConfirm\(/);
  assert.match(dirty, /data-dirty-ignore/);
  assert.match(dirty, /target\.dataset\.dirtyFormId/u);
  assert.match(
    project,
    /mapPanel\.dataset[\s\S]*\.dirtyFormId[\s\S]*'project-settings-form'/u,
  );
  assert.match(project, /Настройки проекта \/ карты/u);
  assert.match(shell, /installDirtyTabGuard\(\)/);
  assert.match(shell, /confirmDirtyNavigation\(/);

  for (const source of [project, report, lineTypes, downloadName, security, data]) {
    assert.match(source, /trackDirtyForm\(/);
  }
});

test('selected admin tabs are session-scoped and never stored in cookies', async () => {
  const [
    state,
    shell,
    layout,
    layoutSchema,
    data,
    project,
    report,
    security,
  ] = await Promise.all([
    read('admin/admin-tab-state.js'),
    read('admin/admin-shell.js'),
    read('admin/admin-layout.js'),
    read('admin/admin-layout-schema.js'),
    read('admin/admin.js'),
    read('admin/project-settings-editor.js'),
    read('admin/report-config-editor.js'),
    read('admin/security-editor-v2.js'),
  ]);

  assert.match(state, /sessionStorage\.getItem/);
  assert.match(state, /sessionStorage\.setItem/);
  assert.doesNotMatch(state, /document\.cookie|localStorage/);

  assert.match(shell, /readTabState\('primary'/);
  assert.match(
    shell,
    /setupAdminTabs\([\s\S]*readState:[\s\S]*readTabState[\s\S]*stateKey:[\s\S]*'interface'/u,
  );
  assert.match(
    layout,
    /readState\([\s\S]*stateKey,[\s\S]*available,[\s\S]*fallback/u,
  );
  assert.match(data, /readTabState\('data-task'/);
  assert.match(data, /data-operation-/);
  assert.match(
    layoutSchema,
    /id:\s*'project'[\s\S]*stateKey:[\s\S]*'project-settings'/u,
  );
  assert.match(
    layoutSchema,
    /id:\s*'report'[\s\S]*stateKey:[\s\S]*'report-view'/u,
  );
  assert.match(
    project,
    /setupAdminTabGroup\([\s\S]*readState:[\s\S]*readTabState[\s\S]*writeState:[\s\S]*writeTabState/u,
  );
  assert.match(
    report,
    /setupAdminTabGroup\([\s\S]*readState:[\s\S]*readTabState[\s\S]*writeState:[\s\S]*writeTabState/u,
  );
  assert.match(
    layoutSchema,
    /export const adminSecurityLayout[\s\S]*stateKey:[\s\S]*'security'/u,
  );
  assert.match(
    security,
    /#security-users-audit-host/u,
  );
  assert.match(
    security,
    /ensureAdminTabGroup\([\s\S]*usersAuditHost[\s\S]*securityTabDefinition/u,
  );
  assert.match(
    security,
    /setupAdminTabGroup\([\s\S]*usersAuditHost[\s\S]*securityTabDefinition[\s\S]*readState:[\s\S]*readTabState[\s\S]*writeState:[\s\S]*writeTabState/u,
  );
  assert.doesNotMatch(
    security,
    /<nav class="security-tabs"/u,
  );
  assert.match(
    security,
    /id="security-panels"/u,
  );
  assert.match(
    security,
    /securityPanels\.users\.innerHTML/u,
  );
  assert.match(
    security,
    /#security-audit-host/u,
  );
  assert.match(
    security,
    /securityAuditHost\.innerHTML/u,
  );
  assert.doesNotMatch(
    security,
    /securityPanels\.audit\.innerHTML/u,
  );
  assert.match(
    security,
    /#security-control-host/u,
  );
  assert.match(
    security,
    /adminSecuritySettingsLayout/u,
  );
  assert.match(
    security,
    /#security-protection-host/u,
  );
  assert.match(
    security,
    /#security-metrics-timings-host/u,
  );
  assert.match(
    security,
    /#security-blocks-host/u,
  );
  assert.match(
    security,
    /setupAdminTabGroup\([\s\S]*securityControlHost[\s\S]*adminSecuritySettingsLayout/u,
  );
  assert.doesNotMatch(
    security,
    /securityPanels\.security\.innerHTML|security-settings-grid/u,
  );
  assert.doesNotMatch(
    security,
    /<section class="security-panel" id="security-panel-/u,
  );
  assert.match(
    shell,
    /'users-audit':[\s\S]*canAccessUsersAudit/u,
  );
  assert.match(
    shell,
    /security:[\s\S]*canManageSecuritySettings/u,
  );
  assert.match(
    shell,
    /dtpstat:users-audit-refresh/u,
  );
  assert.match(
    shell,
    /dtpstat:security-refresh/u,
  );
  assert.match(
    security,
    /dtpstat:users-audit-refresh[\s\S]*loadUsers[\s\S]*loadAudit/u,
  );
  assert.match(
    security,
    /dtpstat:security-refresh[\s\S]*loadSettings[\s\S]*loadIpBlocks/u,
  );
  assert.match(
    security,
    /data-admin-section-panel="security"[\s\S]*!securityPrimaryPanel\.hidden[\s\S]*loadSettings\(\)[\s\S]*loadIpBlocks\(\)/u,
  );
  assert.doesNotMatch(
    security,
    /security-user-blocks-body/u,
  );
  assert.match(
    security,
    /security-ip-blocks-body/u,
  );
  assert.match(
    security,
    /security-ip-allowlist-body/u,
  );
  assert.match(
    security,
    /security-ip-allowlist-preview/u,
  );
  assert.match(
    security,
    /127\.0\.0\.1\/24/u,
  );
  assert.match(
    security,
    /Не удаляется/u,
  );
  const securityCss =
    await read(
      'admin/security-v2.css',
    );
  assert.match(
    securityCss,
    /\.security-ip-allowlist-form[\s\S]*grid-template-columns:[\s\S]*auto/u,
  );
  assert.match(
    security,
    /parseIpNetwork[\s\S]*updateIpAllowlistPreview/u,
  );
  assert.match(
    security,
    /security-user-blocked-filter[\s\S]*showBlockedUsersOnly/u,
  );
  assert.match(
    security,
    /security-user-row-lock/u,
  );
});

test('technical settings are collapsed and raw values get human-readable companions', async () => {
  const [html, security, human, css] = await Promise.all([
    read('admin/index.html'),
    read('admin/security-editor-v2.js'),
    read('admin/admin-human-units.js'),
    read('admin/admin.css'),
  ]);

  assert.match(html, /<summary>Тонкая настройка загрузки<\/summary>/);
  assert.match(html, /<summary>Тонкая настройка источника<\/summary>/);
  assert.match(html, /<summary>Вставить JSON вручную<\/summary>/);
  assert.match(
    security,
    /Метрики и тайминги/u,
  );
  assert.match(
    security,
    /Политика блокировок/u,
  );

  assert.match(html, /data-human-unit="bytes"/);
  assert.match(html, /data-human-unit="milliseconds"/);
  assert.match(html, /data-human-unit="seconds"/);
  assert.match(html, /data-human-unit="meters"/);
  assert.match(security, /data-human-unit="days"/);
  assert.match(human, /formatBytes/);
  assert.match(human, /formatSeconds/);
  assert.match(human, /formatMeters/);
  assert.match(human, /rawValue = input\.value\.trim\(\)/);
  assert.match(human, /function updateHumanUnit\(input, output\)/);
  assert.match(
    human,
    /humanUnitBound === 'true'[\s\S]*updateHumanUnit\(input, output\)/,
  );
  assert.doesNotMatch(human, /≈/);
  assert.match(human, /admin-human-unit-wrap/);
  assert.match(css, /\.admin-human-unit-wrap/);
  assert.match(css, /position:\s*absolute/);
  assert.match(css, /\.admin-human-unit/);
  assert.match(css, /\.admin-advanced-settings/);
});


test('task result panel copies the complete rendered JSON for results and errors', async () => {
  const [html, admin, clipboard, css] = await Promise.all([
    read('admin/index.html'),
    read('admin/admin.js'),
    read('admin/admin-clipboard.js'),
    read('admin/admin.css'),
  ]);

  assert.match(html, /id="result-copy"[^>]*>Копировать<\/button>/);
  assert.match(html, /id="result-copy"[\s\S]*hidden/);
  assert.match(admin, /import \{ copyTextToClipboard \}/);
  assert.match(
    admin,
    /function taskResultPayload\(task\)[\s\S]*\{ error: task\.error \}[\s\S]*task\.result/,
  );
  assert.match(
    admin,
    /copyTextToClipboard\(pretty\(payload\)\)/,
  );
  assert.match(
    admin,
    /elements\.resultCopy\.hidden = payload === undefined/,
  );
  assert.match(
    admin,
    /task\?\.error !== undefined[\s\S]*Копировать JSON ошибки/,
  );
  assert.match(clipboard, /clipboard\.writeText\(value\)/);
  assert.match(clipboard, /documentRef\.execCommand\('copy'\)/);
  assert.match(css, /\.result-copy/);
  assert.doesNotMatch(admin, /\b(?:confirm|alert|prompt)\s*\(/);
});
