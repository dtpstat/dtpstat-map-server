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
  assert.match(feedback, /element\.matches\(MESSAGE_SELECTOR\)/);
  assert.match(feedback, /if \(node === host \|\| host\.contains\(node\)\) continue;/);
  assert.match(feedback, /if \(isFeedbackSource\(node\)\) watch\(node\);/);
  assert.doesNotMatch(feedback, /if \(toneFromElement\(node\)\) watch\(node\);/);
});
