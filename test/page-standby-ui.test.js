import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  fileURLToPath,
} from 'node:url';

const root =
  path.resolve(
    path.dirname(
      fileURLToPath(
        import.meta.url,
      ),
    ),
    '..',
  );

const read =
  (relativePath) =>
    fs.readFile(
      path.join(
        root,
        relativePath,
      ),
      'utf8',
    );

test('public admin and login pages expose the same blocking standby loading state', async () => {
  const [
    publicHtml,
    adminHtml,
    loginHtml,
    publicCss,
    adminCss,
  ] =
    await Promise.all([
      read('index.html'),
      read('admin/index.html'),
      read('admin/login.html'),
      read('public/css/app.css'),
      read('admin/admin.css'),
    ]);

  for (
    const html of [
      publicHtml,
      adminHtml,
      loginHtml,
    ]
  ) {
    assert.match(
      html,
      /id="page-standby"/u,
    );
    assert.match(
      html,
      /page-standby-spinner/u,
    );
    assert.match(
      html,
      /data-page-standby-label/u,
    );
  }

  for (
    const css of [
      publicCss,
      adminCss,
    ]
  ) {
    assert.match(
      css,
      /\.page-standby \{[\s\S]*position: fixed[\s\S]*z-index: 10000/u,
    );
    assert.match(
      css,
      /\.page-standby-spinner[\s\S]*animation: page-standby-spin/u,
    );
    assert.match(
      css,
      /prefers-reduced-motion/u,
    );
  }
});

test('page bootstrap hides standby after readiness and restores it on navigation', async () => {
  const [
    helper,
    publicApp,
    adminShell,
    login,
  ] =
    await Promise.all([
      read('public/js/page-standby.js'),
      read('public/js/app.js'),
      read('admin/admin-shell.js'),
      read('admin/login.js'),
    ]);

  assert.match(
    helper,
    /beforeunload[\s\S]*showPageStandby/u,
  );
  assert.match(
    helper,
    /export function hidePageStandby/u,
  );
  assert.match(
    publicApp,
    /finally \{[\s\S]*hidePageStandby\(\)/u,
  );
  assert.match(
    adminShell,
    /finally \{[\s\S]*hidePageStandby\(\)/u,
  );
  assert.match(
    login,
    /await alreadyAuthenticated\(\)[\s\S]*hidePageStandby\(\)/u,
  );
  assert.match(
    login,
    /showPageStandby\([\s\S]*Открываем админку/u,
  );
});
