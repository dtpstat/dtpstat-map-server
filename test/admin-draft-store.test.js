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

function storageEvents() {
  const listeners = new Set();
  return {
    addEventListener(type, listener) {
      if (type === 'storage') listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === 'storage') listeners.delete(listener);
    },
    dispatch(event) {
      for (const listener of listeners) listener(event);
    },
  };
}

function storagePayload(storageValue) {
  return storageValue
    ? JSON.parse(storageValue).drafts
    : {};
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


test('draft store conflict marking is idempotent and does not rewrite unchanged shared state', () => {
  const sessionStorage = storage();
  const localStorage = storage();
  let stamp = 0;
  const store = createDraftStore({
    namespace: 'city-geometries',
    sessionStorage,
    localStorage,
    now: () =>
      `2026-09-26T12:00:0${stamp++}.000Z`,
  });

  store.upsert(4, {
    baseUpdatedAt:
      '2026-09-26T11:00:00.000Z',
    changes: {
      displayName:
        'Draft',
    },
  });

  const first =
    store.markConflict(
      4,
      true,
    );
  const second =
    store.markConflict(
      4,
      true,
    );

  assert.equal(
    first.updatedAt,
    second.updatedAt,
  );
  assert.equal(
    second.conflict,
    true,
  );
});

test('persistent draft store emits only relevant external localStorage changes', () => {
  const sessionStorage = storage();
  const localStorage = storage();
  const eventTarget =
    storageEvents();
  const store =
    createDraftStore({
      namespace:
        'city-geometries',
      sessionStorage,
      localStorage,
      eventTarget,
    });

  store.setPersistent(true);

  const key =
    'dtpstat:drafts:city-geometries:local';
  const before =
    localStorage.getItem(
      key,
    );
  const previous =
    storagePayload(
      before,
    );

  previous['8'] = {
    baseUpdatedAt:
      '2026-09-26T11:00:00.000Z',
    changes: {
      displayName:
        'Other tab',
    },
    conflict: false,
    updatedAt:
      '2026-09-26T12:00:00.000Z',
  };

  const after =
    JSON.stringify({
      version: 1,
      drafts: previous,
    });

  localStorage.setItem(
    key,
    after,
  );

  const events = [];
  const unsubscribe =
    store.subscribe(
      (event) =>
        events.push(event),
    );

  eventTarget.dispatch({
    key,
    oldValue: before,
    newValue: after,
    storageArea:
      localStorage,
  });

  assert.deepEqual(
    events,
    [{
      source:
        'external-storage',
      persistent: true,
      modeChanged: false,
      changedIds: ['8'],
      removedIds: [],
    }],
  );

  unsubscribe();

  eventTarget.dispatch({
    key,
    oldValue: after,
    newValue: before,
    storageArea:
      localStorage,
  });

  assert.equal(
    events.length,
    1,
  );
});

test('persistent mode changes preserve drafts from multiple tabs instead of overwriting them', () => {
  const sharedLocal =
    storage();
  const firstSession =
    storage();
  const secondSession =
    storage();
  const firstEvents =
    storageEvents();
  const secondEvents =
    storageEvents();

  const first =
    createDraftStore({
      namespace:
        'city-geometries',
      sessionStorage:
        firstSession,
      localStorage:
        sharedLocal,
      eventTarget:
        firstEvents,
      now: () =>
        '2026-09-26T12:00:00.000Z',
    });
  const second =
    createDraftStore({
      namespace:
        'city-geometries',
      sessionStorage:
        secondSession,
      localStorage:
        sharedLocal,
      eventTarget:
        secondEvents,
      now: () =>
        '2026-09-26T12:00:01.000Z',
    });

  first.upsert(1, {
    baseUpdatedAt:
      '2026-09-26T10:00:00.000Z',
    changes: {
      displayName:
        'First',
    },
  });
  second.upsert(2, {
    baseUpdatedAt:
      '2026-09-26T10:00:00.000Z',
    changes: {
      displayName:
        'Second',
    },
  });

  second.subscribe(
    () => {},
  );

  const localKey =
    'dtpstat:drafts:city-geometries:local';
  const preferenceKey =
    'dtpstat:drafts:city-geometries:persistence';

  const oldLocal =
    sharedLocal.getItem(
      localKey,
    );

  first.setPersistent(
    true,
  );

  const newLocal =
    sharedLocal.getItem(
      localKey,
    );

  secondEvents.dispatch({
    key: localKey,
    oldValue: oldLocal,
    newValue: newLocal,
    storageArea:
      sharedLocal,
  });
  secondEvents.dispatch({
    key: preferenceKey,
    oldValue: null,
    newValue: 'local',
    storageArea:
      sharedLocal,
  });

  assert.equal(
    second.isPersistent(),
    true,
  );
  assert.deepEqual(
    second.get(1)?.changes,
    {
      displayName:
        'First',
    },
  );
  assert.deepEqual(
    second.get(2)?.changes,
    {
      displayName:
        'Second',
    },
  );
  assert.deepEqual(
    first.get(2)?.changes,
    {
      displayName:
        'Second',
    },
  );
});


test('disabling persistent mode in another tab preserves the shared draft in session storage', () => {
  const sharedLocal =
    storage();
  const firstSession =
    storage();
  const secondSession =
    storage();
  const firstEvents =
    storageEvents();
  const secondEvents =
    storageEvents();

  const first =
    createDraftStore({
      namespace:
        'osm-boundaries',
      sessionStorage:
        firstSession,
      localStorage:
        sharedLocal,
      eventTarget:
        firstEvents,
      now: () =>
        '2026-09-26T13:00:00.000Z',
    });

  first.upsert(9, {
    baseUpdatedAt:
      '2026-09-26T12:00:00.000Z',
    changes: {
      active: false,
    },
  });
  first.setPersistent(true);

  const second =
    createDraftStore({
      namespace:
        'osm-boundaries',
      sessionStorage:
        secondSession,
      localStorage:
        sharedLocal,
      eventTarget:
        secondEvents,
    });

  const events = [];
  second.subscribe(
    (event) =>
      events.push(event),
  );

  const localKey =
    'dtpstat:drafts:osm-boundaries:local';
  const preferenceKey =
    'dtpstat:drafts:osm-boundaries:persistence';
  const before =
    sharedLocal.getItem(
      localKey,
    );

  first.setPersistent(
    false,
  );

  secondEvents.dispatch({
    key: localKey,
    oldValue: before,
    newValue: null,
    storageArea:
      sharedLocal,
  });
  secondEvents.dispatch({
    key: preferenceKey,
    oldValue: 'local',
    newValue: null,
    storageArea:
      sharedLocal,
  });

  assert.equal(
    second.isPersistent(),
    false,
  );
  assert.deepEqual(
    second.get(9)?.changes,
    {
      active: false,
    },
  );
  assert.equal(
    events.length,
    1,
  );
  assert.equal(
    events[0].modeChanged,
    true,
  );
  assert.deepEqual(
    events[0].changedIds,
    [],
  );
  assert.deepEqual(
    events[0].removedIds,
    [],
  );
});
