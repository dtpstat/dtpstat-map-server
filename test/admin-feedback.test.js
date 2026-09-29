import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function source(relativePath) {
  return fs.readFile(path.join(projectRoot, relativePath), 'utf8');
}

test('admin action feedback never observes its own toast output', async () => {
  const feedback = await source('admin/action-feedback.js');

  assert.match(feedback, /const MESSAGE_SELECTOR =/);
  assert.match(
    feedback,
    /element\.matches\(\s*MESSAGE_SELECTOR,?\s*\)/u,
  );
  assert.match(feedback, /if \(node === host \|\| host\.contains\(node\)\) continue;/);
  assert.match(feedback, /if \(isFeedbackSource\(node\)\) watch\(node\);/);
  assert.doesNotMatch(feedback, /if \(toneFromElement\(node\)\) watch\(node\);/);
});


test('admin action feedback renders the shared typed notification pool', async () => {
  const [
    feedback,
    center,
    styles,
  ] = await Promise.all([
    source('admin/action-feedback.js'),
    source('admin/notification-center.js'),
    source('admin/action-feedback.css'),
  ]);

  assert.match(
    feedback,
    /subscribeAdminNotifications/u,
  );
  assert.match(
    feedback,
    /dtpstatNotifications/u,
  );
  assert.match(
    center,
    /'info'[\s\S]*'log'[\s\S]*'warn'[\s\S]*'error'/u,
  );
  assert.match(
    center,
    /level === 'warn'[\s\S]*level === 'error'[\s\S]*true/u,
  );
  assert.match(
    styles,
    /\.admin-feedback-toast\.is-log/u,
  );
  assert.match(
    styles,
    /\.admin-feedback-toast\.is-warn/u,
  );
});
