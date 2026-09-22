import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFile(path.join(root, relativePath), 'utf8');

test('admin data and project settings are split into meaningful visual groups', async () => {
  const [html, project, adminCss, reportCss] = await Promise.all([
    read('admin/index.html'),
    read('admin/project-settings-editor.js'),
    read('admin/admin.css'),
    read('admin/report-config.css'),
  ]);

  assert.match(html, /<legend>Что загружать<\/legend>/);
  assert.match(html, /<legend>Как и откуда загружать<\/legend>/);
  assert.match(html, /class="export-link"[^>]*>↓ Экспорт GeoJSON<\/a>/);
  assert.match(html, /class="export-link"[^>]*>↓ Экспорт ZIP<\/a>/);
  assert.match(adminCss, /\.osm-config-group/);
  assert.match(adminCss, /\.export-link/);

  assert.match(project, /data-project-settings-tab="general"/);
  assert.match(project, /data-project-settings-tab="map"/);
  assert.match(project, /data-project-settings-tab="metadata"/);
  assert.match(project, /data-project-settings-tab="footer"/);
  assert.match(project, /selectProjectPanel\('general'\)/);

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
    read('src/data/admin-security.js'),
  ]);

  assert.match(security, /function userListRow\(user\)/);
  assert.match(security, /class="security-user-avatar"/);
  assert.match(security, /if \(user\.hasAvatar\)/);
  assert.match(securityCss, /\.security-user-avatar/);

  assert.match(profile, /profile-avatar-upload-label/);
  assert.match(profile, /id="profile-avatar-delete" disabled/);
  assert.match(profileCss, /\.profile-avatar-actions[\s\S]*grid-template-columns:\s*repeat\(2/);
  assert.match(profileCss, /\.profile-avatar-action/);

  assert.match(security, /name="passwordMinLength"/);
  assert.match(security, /name="passwordMaxLength"/);
  assert.match(security, /name="passwordRequireLowercase"/);
  assert.match(security, /name="passwordRequireUppercase"/);
  assert.match(security, /name="passwordRequireDigit"/);
  assert.match(security, /name="passwordRequireSpecial"/);
  assert.match(securityData, /DEFAULT_ADMIN_PASSWORD_POLICY/);
  assert.match(securityData, /passwordRequireSpecial/);

  assert.match(profile, /\/api\/admin\/profile\/password-policy/);
  assert.match(profile, /id="profile-password-policy"/);
  assert.match(profile, /id="profile-confirm-overlay"/);
  assert.doesNotMatch(profile, /window\.confirm\(/);
  assert.match(profile, /class="danger" id="profile-revoke-others"/);
  assert.match(profileCss, /\.profile-session \.danger/);
  assert.match(profileCss, /\.profile-confirm-overlay/);
});
