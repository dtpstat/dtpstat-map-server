import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { applyAdminBranding } from '../admin/project-branding.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('admin loads project branding module', async () => {
  const source = await fs.readFile(
    path.join(projectRoot, 'admin/task-notices.js'),
    'utf8',
  );
  assert.match(source, /import '\.\/project-branding\.js'/);
});

test('project name is applied to admin heading and browser title', () => {
  const previousDocument = globalThis.document;
  const eyebrow = { textContent: 'DTPSTAT BUSLINES' };
  const heading = { textContent: 'Администрирование данных' };
  const topbar = {
    querySelector(selector) {
      if (selector === '.eyebrow') return eyebrow;
      if (selector === 'h1') return heading;
      return null;
    },
  };

  globalThis.document = {
    title: 'Администрирование — выделенные полосы',
    querySelector(selector) {
      return selector === '.topbar' ? topbar : null;
    },
  };

  try {
    assert.equal(applyAdminBranding('  Выделенные полосы в России  '), true);
    assert.equal(eyebrow.textContent, 'Администрирование');
    assert.equal(heading.textContent, 'Выделенные полосы в России');
    assert.equal(
      globalThis.document.title,
      'Администрирование — Выделенные полосы в России',
    );
    assert.equal(applyAdminBranding('   '), false);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
