import assert from 'node:assert/strict';
import test from 'node:test';
import {
  adminAuditPayloadFingerprint,
  createAdminAuditChangeSet,
  sanitizeAdminAuditData,
} from '../src/data/admin-audit-details.js';

test('admin audit change set records concrete field-level before and after values', () => {
  const result = createAdminAuditChangeSet(
    {
      projectName: 'Old name',
      themePreset: 'classic',
      flags: { labels: false },
      lineTypes: [{ name: 'bus', width: 4 }],
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      projectName: 'New name',
      themePreset: 'modern',
      flags: { labels: true },
      lineTypes: [{ name: 'bus', width: 6 }],
      updatedAt: '2026-09-08T00:00:00.000Z',
    },
  );

  assert.deepEqual(result, {
    changes: [
      { path: 'flags.labels', before: false, after: true },
      { path: 'lineTypes[0].width', before: 4, after: 6 },
      { path: 'projectName', before: 'Old name', after: 'New name' },
      { path: 'themePreset', before: 'classic', after: 'modern' },
    ],
  });
});

test('admin audit never exposes security-like values and still records that the field changed', () => {
  const result = createAdminAuditChangeSet(
    {
      mapboxAccessToken: 'pk.old-secret-value',
      nested: { apiKey: 'old-key', title: 'old' },
    },
    {
      mapboxAccessToken: 'pk.new-secret-value',
      nested: { apiKey: 'new-key', title: 'new' },
    },
  );

  assert.deepEqual(result.changes, [
    {
      path: 'mapboxAccessToken',
      before: '[redacted]',
      after: '[redacted]',
      sensitive: true,
    },
    {
      path: 'nested.apiKey',
      before: '[redacted]',
      after: '[redacted]',
      sensitive: true,
    },
    { path: 'nested.title', before: 'old', after: 'new' },
  ]);
  assert.doesNotMatch(JSON.stringify(result), /old-secret|new-secret|old-key|new-key/);
});

test('admin audit sanitizer summarizes binary data, redacts nested tokens and bounds long strings', () => {
  const sanitized = sanitizeAdminAuditData({
    note: 'x'.repeat(1200),
    payload: Buffer.alloc(17),
    nested: { sessionToken: 'must-not-leak' },
  });

  assert.deepEqual(sanitized.payload, { binary: true, bytes: 17 });
  assert.equal(sanitized.nested.sessionToken, '[redacted]');
  assert.ok(sanitized.note.length < 1200);
  assert.match(sanitized.note, /truncated 200 chars/);
});

test('payload fingerprint identifies exact imported content without storing content', () => {
  const first = adminAuditPayloadFingerprint({ features: [{ id: 1 }] });
  const same = adminAuditPayloadFingerprint({ features: [{ id: 1 }] });
  const different = adminAuditPayloadFingerprint({ features: [{ id: 2 }] });

  assert.equal(first.bytes, same.bytes);
  assert.equal(first.sha256, same.sha256);
  assert.notEqual(first.sha256, different.sha256);
  assert.match(first.sha256, /^[a-f0-9]{64}$/);
});
