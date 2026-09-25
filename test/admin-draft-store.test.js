import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDraftStore,
} from '../admin/draft-store.js';

function storage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

test('draft store defaults to session storage and persists optimistic base revision', () => {
  const sessionStorage = storage();
  const localStorage = storage();
  const store = createDraftStore({
    namespace: 'osm-boundaries',
    sessionStorage,
    localStorage,
    now: () => '2026-09-25T12:00:00.000Z',
  });

  store.upsert(12, {
    baseUpdatedAt: '2026-09-25T11:00:00.000Z',
    changes: { displayName: 'Draft' },
  });

  assert.equal(store.isPersistent(), false);
  assert.deepEqual(store.get(12), {
    baseUpdatedAt: '2026-09-25T11:00:00.000Z',
    changes: { displayName: 'Draft' },
    conflict: false,
    updatedAt: '2026-09-25T12:00:00.000Z',
  });
  assert.equal(localStorage.getItem('dtpstat:drafts:osm-boundaries:local'), null);
});

test('draft store migrates drafts between session and local storage', () => {
  const sessionStorage = storage();
  const localStorage = storage();
  const store = createDraftStore({
    namespace: 'osm-boundaries',
    sessionStorage,
    localStorage,
  });

  store.upsert(7, {
    baseUpdatedAt: '2026-09-25T10:00:00.000Z',
    changes: { active: false },
  });
  store.setPersistent(true);

  assert.equal(store.isPersistent(), true);
  assert.equal(
    sessionStorage.getItem('dtpstat:drafts:osm-boundaries:session'),
    null,
  );
  assert.match(
    localStorage.getItem('dtpstat:drafts:osm-boundaries:local'),
    /"7"/u,
  );

  const restored = createDraftStore({
    namespace: 'osm-boundaries',
    sessionStorage,
    localStorage,
  });
  assert.equal(restored.isPersistent(), true);
  assert.deepEqual(restored.get(7)?.changes, { active: false });

  restored.setPersistent(false);
  assert.equal(restored.isPersistent(), false);
  assert.equal(
    localStorage.getItem('dtpstat:drafts:osm-boundaries:local'),
    null,
  );
  assert.match(
    sessionStorage.getItem('dtpstat:drafts:osm-boundaries:session'),
    /"7"/u,
  );
});

test('draft store tracks conflicts without losing local changes', () => {
  const store = createDraftStore({
    namespace: 'osm-boundaries',
    sessionStorage: storage(),
    localStorage: storage(),
  });

  store.upsert(3, {
    baseUpdatedAt: '2026-09-25T09:00:00.000Z',
    changes: { population: 1000 },
  });
  store.markConflict(3, true);

  assert.equal(store.get(3)?.conflict, true);
  assert.deepEqual(store.get(3)?.changes, { population: 1000 });

  store.remove(3);
  assert.equal(store.get(3), null);
});
