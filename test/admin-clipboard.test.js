import assert from 'node:assert/strict';
import test from 'node:test';
import { copyTextToClipboard } from '../admin/admin-clipboard.js';

test('admin clipboard uses the async Clipboard API when available', async () => {
  const writes = [];
  const copied = await copyTextToClipboard('{"ok":true}', {
    clipboard: {
      async writeText(value) {
        writes.push(value);
      },
    },
    documentRef: null,
  });

  assert.equal(copied, true);
  assert.deepEqual(writes, ['{"ok":true}']);
});

test('admin clipboard falls back to a temporary textarea', async () => {
  const events = [];
  const textarea = {
    value: '',
    style: {},
    setAttribute(name, value) {
      events.push(['attribute', name, value]);
    },
    focus() {
      events.push(['focus']);
    },
    select() {
      events.push(['select']);
    },
    remove() {
      events.push(['remove']);
    },
  };
  const documentRef = {
    body: {
      append(node) {
        events.push(['append', node.value]);
      },
    },
    createElement(name) {
      assert.equal(name, 'textarea');
      return textarea;
    },
    execCommand(command) {
      events.push(['execCommand', command, textarea.value]);
      return true;
    },
  };

  const copied = await copyTextToClipboard('full json', {
    clipboard: {
      async writeText() {
        throw new Error('denied');
      },
    },
    documentRef,
  });

  assert.equal(copied, true);
  assert.ok(events.some((entry) =>
    entry[0] === 'execCommand' &&
    entry[1] === 'copy' &&
    entry[2] === 'full json'));
  assert.deepEqual(events.at(-1), ['remove']);
});

test('admin clipboard reports failure when no copy mechanism is available', async () => {
  assert.equal(await copyTextToClipboard('x', {
    clipboard: null,
    documentRef: null,
  }), false);
});
