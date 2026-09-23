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
  assert.match(shell, /installDirtyTabGuard\(\)/);
  assert.match(shell, /confirmDirtyNavigation\(/);

  for (const source of [project, report, lineTypes, downloadName, security, data]) {
    assert.match(source, /trackDirtyForm\(/);
  }
});

test('selected admin tabs are session-scoped and never stored in cookies', async () => {
  const [state, shell, data, project, report, security] = await Promise.all([
    read('admin/admin-tab-state.js'),
    read('admin/admin-shell.js'),
    read('admin/admin.js'),
    read('admin/project-settings-editor.js'),
    read('admin/report-config-editor.js'),
    read('admin/security-editor-v2.js'),
  ]);

  assert.match(state, /sessionStorage\.getItem/);
  assert.match(state, /sessionStorage\.setItem/);
  assert.doesNotMatch(state, /document\.cookie|localStorage/);

  assert.match(shell, /readTabState\('primary'/);
  assert.match(shell, /readTabState\([\s\S]*'interface'/);
  assert.match(data, /readTabState\('data-task'/);
  assert.match(data, /data-operation-/);
  assert.match(project, /'project-settings'/);
  assert.match(report, /'report-view'/);
  assert.match(security, /'security'/);
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
  assert.match(security, /Тонкая настройка блокировок, сессий и аудита/);

  assert.match(html, /data-human-unit="bytes"/);
  assert.match(html, /data-human-unit="milliseconds"/);
  assert.match(html, /data-human-unit="seconds"/);
  assert.match(html, /data-human-unit="meters"/);
  assert.match(security, /data-human-unit="days"/);
  assert.match(human, /formatBytes/);
  assert.match(human, /formatSeconds/);
  assert.match(human, /formatMeters/);
  assert.match(human, /admin-human-unit-wrap/);
  assert.match(css, /\.admin-human-unit-wrap/);
  assert.match(css, /position:\s*absolute/);
  assert.match(css, /\.admin-human-unit/);
  assert.match(css, /\.admin-advanced-settings/);
});
