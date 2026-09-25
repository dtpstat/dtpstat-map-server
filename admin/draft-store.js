const STORAGE_VERSION = 1;

function safeStorage(storage) {
  try {
    if (!storage) return null;
    const key = '__dtpstat_draft_probe__';
    storage.setItem(key, '1');
    storage.removeItem(key);
    return storage;
  } catch {
    return null;
  }
}

function parsePayload(raw) {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      value.version !== STORAGE_VERSION ||
      !value.drafts ||
      typeof value.drafts !== 'object' ||
      Array.isArray(value.drafts)
    ) {
      return {};
    }
    return value.drafts;
  } catch {
    return {};
  }
}

function clone(value) {
  return structuredClone(value);
}

export function createDraftStore({
  namespace,
  sessionStorage = globalThis.sessionStorage,
  localStorage = globalThis.localStorage,
  now = () => new Date().toISOString(),
} = {}) {
  if (typeof namespace !== 'string' || !namespace.trim()) {
    throw new TypeError('Draft namespace is required');
  }

  const normalizedNamespace = namespace.trim();
  const session = safeStorage(sessionStorage);
  const local = safeStorage(localStorage);
  const preferenceKey = `dtpstat:drafts:${normalizedNamespace}:persistence`;
  const sessionKey = `dtpstat:drafts:${normalizedNamespace}:session`;
  const localKey = `dtpstat:drafts:${normalizedNamespace}:local`;

  let persistent = false;
  try {
    persistent = local?.getItem(preferenceKey) === 'local';
  } catch {
    persistent = false;
  }

  const storageFor = (usePersistent = persistent) =>
    usePersistent && local
      ? { storage: local, key: localKey }
      : { storage: session, key: sessionKey };

  function read(usePersistent = persistent) {
    const target = storageFor(usePersistent);
    return parsePayload(target.storage?.getItem(target.key));
  }

  function write(drafts, usePersistent = persistent) {
    const target = storageFor(usePersistent);
    if (!target.storage) return;
    target.storage.setItem(
      target.key,
      JSON.stringify({
        version: STORAGE_VERSION,
        drafts,
      }),
    );
  }

  function removeStorage(usePersistent) {
    const target = storageFor(usePersistent);
    target.storage?.removeItem(target.key);
  }

  return {
    isPersistent() {
      return Boolean(persistent && local);
    },

    setPersistent(nextPersistent) {
      const next = Boolean(nextPersistent && local);
      if (next === persistent) return this.isPersistent();

      const drafts = read(persistent);
      write(drafts, next);
      removeStorage(persistent);
      persistent = next;

      try {
        if (local) {
          if (persistent) {
            local.setItem(preferenceKey, 'local');
          } else {
            local.removeItem(preferenceKey);
          }
        }
      } catch {
        // Persistence preference is best-effort.
      }

      return this.isPersistent();
    },

    list() {
      return Object.entries(read())
        .map(([id, draft]) => ({
          id,
          ...clone(draft),
        }));
    },

    get(id) {
      const draft = read()[String(id)];
      return draft ? clone(draft) : null;
    },

    upsert(id, draft) {
      const key = String(id);
      const drafts = read();
      drafts[key] = {
        baseUpdatedAt: draft.baseUpdatedAt,
        changes: clone(draft.changes ?? {}),
        conflict: Boolean(draft.conflict),
        updatedAt: now(),
      };
      write(drafts);
      return this.get(key);
    },

    markConflict(id, conflict = true) {
      const key = String(id);
      const drafts = read();
      if (!drafts[key]) return null;
      drafts[key] = {
        ...drafts[key],
        conflict: Boolean(conflict),
        updatedAt: now(),
      };
      write(drafts);
      return this.get(key);
    },

    remove(id) {
      const drafts = read();
      const key = String(id);
      const existed = Boolean(drafts[key]);
      delete drafts[key];
      write(drafts);
      return existed;
    },

    clear() {
      write({});
    },
  };
}
