export const DRAFT_STORAGE_VERSION =
  2;

export class DraftStoreVersionError
  extends Error {
  constructor(
    message,
    {
      foundVersion = null,
      expectedVersion =
        DRAFT_STORAGE_VERSION,
      corrupt = false,
    } = {},
  ) {
    super(message);
    this.name =
      'DraftStoreVersionError';
    this.foundVersion =
      foundVersion;
    this.expectedVersion =
      expectedVersion;
    this.corrupt =
      Boolean(corrupt);
  }
}

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

function draftMap(value) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value)
  )
    ? value
    : null;
}

function decodePayload(raw) {
  if (!raw) {
    return {
      version:
        DRAFT_STORAGE_VERSION,
      drafts: {},
      migrated: false,
    };
  }

  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new DraftStoreVersionError(
      'Draft storage contains invalid JSON and was preserved unchanged',
      {
        corrupt: true,
      },
    );
  }

  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    throw new DraftStoreVersionError(
      'Draft storage has an unsupported envelope and was preserved unchanged',
      {
        corrupt: true,
      },
    );
  }

  if (
    value.version === 1
  ) {
    const drafts =
      draftMap(
        value.drafts,
      );
    if (!drafts) {
      throw new DraftStoreVersionError(
        'Draft storage v1 is malformed and was preserved unchanged',
        {
          foundVersion: 1,
          corrupt: true,
        },
      );
    }

    return {
      version:
        DRAFT_STORAGE_VERSION,
      drafts,
      migrated: true,
    };
  }

  if (
    value.version !==
    DRAFT_STORAGE_VERSION
  ) {
    throw new DraftStoreVersionError(
      value.version >
        DRAFT_STORAGE_VERSION
        ? 'Draft storage was written by a newer client; reload/update before continuing'
        : 'Draft storage version is unsupported and was preserved unchanged',
      {
        foundVersion:
          value.version ??
          null,
      },
    );
  }

  const drafts =
    draftMap(
      value.drafts,
    );

  if (!drafts) {
    throw new DraftStoreVersionError(
      'Draft storage v2 is malformed and was preserved unchanged',
      {
        foundVersion:
          value.version,
        corrupt: true,
      },
    );
  }

  return {
    version:
      DRAFT_STORAGE_VERSION,
    drafts,
    migrated: false,
  };
}

function encodePayload(
  drafts,
) {
  return JSON.stringify({
    version:
      DRAFT_STORAGE_VERSION,
    drafts,
  });
}
function clone(value) {
  return structuredClone(value);
}

function draftUpdatedAt(draft) {
  return String(
    draft?.updatedAt ??
    '',
  );
}

function sameDraft(
  left,
  right,
) {
  return JSON.stringify(left) ===
    JSON.stringify(right);
}

function sameDraftMap(
  left,
  right,
) {
  const leftKeys =
    Object.keys(left).sort();
  const rightKeys =
    Object.keys(right).sort();

  if (
    leftKeys.length !==
    rightKeys.length
  ) {
    return false;
  }

  return leftKeys.every(
    (key, index) =>
      key ===
        rightKeys[index] &&
      sameDraft(
        left[key],
        right[key],
      ),
  );
}

function mergeDraftMaps(
  left,
  right,
) {
  const merged = {};

  for (
    const key of
    new Set([
      ...Object.keys(left),
      ...Object.keys(right),
    ])
  ) {
    const first =
      left[key];
    const second =
      right[key];

    if (!first) {
      merged[key] =
        clone(second);
      continue;
    }

    if (!second) {
      merged[key] =
        clone(first);
      continue;
    }

    const firstUpdated =
      draftUpdatedAt(first);
    const secondUpdated =
      draftUpdatedAt(second);

    let selected =
      secondUpdated >=
      firstUpdated
        ? second
        : first;

    if (
      sameDraft(
        {
          ...first,
          conflict: false,
          updatedAt: '',
        },
        {
          ...second,
          conflict: false,
          updatedAt: '',
        },
      ) &&
      (
        first.conflict ||
        second.conflict
      )
    ) {
      selected = {
        ...selected,
        conflict: true,
      };
    }

    merged[key] =
      clone(selected);
  }

  return merged;
}

function changedDraftIds(
  previous,
  current,
) {
  const changedIds = [];
  const removedIds = [];

  for (
    const key of
    new Set([
      ...Object.keys(previous),
      ...Object.keys(current),
    ])
  ) {
    if (
      !(key in current)
    ) {
      removedIds.push(key);
      continue;
    }

    if (
      !(key in previous) ||
      !sameDraft(
        previous[key],
        current[key],
      )
    ) {
      changedIds.push(key);
    }
  }

  return {
    changedIds,
    removedIds,
  };
}

export function createDraftStore({
  namespace,
  sessionStorage = globalThis.sessionStorage,
  localStorage = globalThis.localStorage,
  eventTarget = globalThis.window ?? null,
  now = () => new Date().toISOString(),
} = {}) {
  if (
    typeof namespace !== 'string' ||
    !namespace.trim()
  ) {
    throw new TypeError(
      'Draft namespace is required',
    );
  }

  const normalizedNamespace =
    namespace.trim();
  const session =
    safeStorage(
      sessionStorage,
    );
  const local =
    safeStorage(
      localStorage,
    );
  const preferenceKey =
    `dtpstat:drafts:${normalizedNamespace}:persistence`;
  const sessionKey =
    `dtpstat:drafts:${normalizedNamespace}:session`;
  const localKey =
    `dtpstat:drafts:${normalizedNamespace}:local`;

  let persistent = false;
  let pendingLocalRemoval =
    null;
  const listeners =
    new Set();
  let compatibilityIssue =
    null;

  try {
    persistent =
      local?.getItem(
        preferenceKey,
      ) === 'local';
  } catch {
    persistent = false;
  }

  const storageFor =
    (
      usePersistent =
        persistent,
    ) =>
      usePersistent &&
      local
        ? {
            storage: local,
            key: localKey,
          }
        : {
            storage: session,
            key: sessionKey,
          };

  function rememberIssue(
    error,
  ) {
    if (
      error instanceof
      DraftStoreVersionError
    ) {
      compatibilityIssue =
        error;
    }
    throw error;
  }

  function assertCompatible() {
    if (
      compatibilityIssue
    ) {
      throw compatibilityIssue;
    }
  }

  function read(
    usePersistent =
      persistent,
  ) {
    assertCompatible();

    const target =
      storageFor(
        usePersistent,
      );

    let decoded;
    try {
      decoded =
        decodePayload(
          target.storage
            ?.getItem(
              target.key,
            ),
        );
    } catch (error) {
      return rememberIssue(
        error,
      );
    }

    if (
      decoded.migrated &&
      target.storage
    ) {
      target.storage.setItem(
        target.key,
        encodePayload(
          decoded.drafts,
        ),
      );
    }

    return clone(
      decoded.drafts,
    );
  }

  function write(
    drafts,
    usePersistent =
      persistent,
  ) {
    const target =
      storageFor(
        usePersistent,
      );
    if (!target.storage) {
      return;
    }

    assertCompatible();

    let previous;
    try {
      previous =
        decodePayload(
          target.storage
            .getItem(
              target.key,
            ),
        ).drafts;
    } catch (error) {
      return rememberIssue(
        error,
      );
    }

    if (
      sameDraftMap(
        previous,
        drafts,
      )
    ) {
      return;
    }

    target.storage
      .setItem(
        target.key,
        encodePayload(
          drafts,
        ),
      );
  }

  function removeStorage(
    usePersistent,
  ) {
    const target =
      storageFor(
        usePersistent,
      );
    target.storage
      ?.removeItem(
        target.key,
      );
  }

  function notify(
    previous,
    current,
    details = {},
  ) {
    const diff =
      changedDraftIds(
        previous,
        current,
      );

    if (
      diff.changedIds.length ===
        0 &&
      diff.removedIds.length ===
        0 &&
      !details.modeChanged
    ) {
      return;
    }

    const event = {
      source:
        details.source ??
        'external',
      persistent:
        Boolean(
          persistent &&
          local,
        ),
      modeChanged:
        Boolean(
          details.modeChanged,
        ),
      incompatible:
        Boolean(
          details.incompatible,
        ),
      ...diff,
    };

    for (
      const listener of
      listeners
    ) {
      try {
        listener(
          clone(event),
        );
      } catch (error) {
        console.error(
          'Draft store listener failed',
          error,
        );
      }
    }
  }

  function migrateToPersistent() {
    const previous =
      read(false);
    const merged =
      mergeDraftMaps(
        read(true),
        previous,
      );

    write(
      merged,
      true,
    );
    removeStorage(
      false,
    );
    persistent = true;
    return {
      previous,
      current:
        merged,
    };
  }

  function migrateToSession(
    previousOverride = null,
  ) {
    const previous =
      previousOverride ??
      read(true);
    const merged =
      mergeDraftMaps(
        read(false),
        previous,
      );

    write(
      merged,
      false,
    );
    persistent = false;
    return {
      previous,
      current:
        merged,
    };
  }

  function onStorage(
    event,
  ) {
    if (
      !event ||
      (
        event.storageArea &&
        local &&
        event.storageArea !==
          local
      )
    ) {
      return;
    }

    if (
      event.key ===
      localKey
    ) {
      let previous;
      let current;
      try {
        previous =
          decodePayload(
            event.oldValue,
          ).drafts;
        current =
          decodePayload(
            event.newValue,
          ).drafts;
      } catch (error) {
        if (
          error instanceof
          DraftStoreVersionError
        ) {
          compatibilityIssue =
            error;
          notify(
            {},
            {},
            {
              source:
                'external-storage',
              modeChanged: true,
              incompatible: true,
            },
          );
          return;
        }
        throw error;
      }

      if (
        persistent &&
        event.newValue ===
          null
      ) {
        pendingLocalRemoval =
          previous;
        const existingSession =
          read(false);
        write(
          mergeDraftMaps(
            existingSession,
            previous,
          ),
          false,
        );
        return;
      }

      if (persistent) {
        notify(
          previous,
          current,
          {
            source:
              'external-storage',
          },
        );
      }
      return;
    }

    if (
      event.key !==
      preferenceKey
    ) {
      return;
    }

    const nextPersistent =
      Boolean(
        local &&
        event.newValue ===
          'local',
      );

    if (
      nextPersistent ===
      persistent
    ) {
      pendingLocalRemoval =
        null;
      return;
    }

    if (nextPersistent) {
      const {
        previous,
        current,
      } =
        migrateToPersistent();

      notify(
        previous,
        current,
        {
          source:
            'external-storage',
          modeChanged: true,
        },
      );
    } else {
      const before =
        pendingLocalRemoval ??
        read(true);
      const {
        current,
      } =
        migrateToSession(
          before,
        );

      pendingLocalRemoval =
        null;
      notify(
        before,
        current,
        {
          source:
            'external-storage',
          modeChanged: true,
        },
      );
    }
  }

  let listening = false;

  function ensureListening() {
    if (
      listening ||
      typeof eventTarget
        ?.addEventListener !==
        'function'
    ) {
      return;
    }

    eventTarget
      .addEventListener(
        'storage',
        onStorage,
      );
    listening = true;
  }

  function stopListening() {
    if (
      !listening ||
      listeners.size > 0 ||
      typeof eventTarget
        ?.removeEventListener !==
        'function'
    ) {
      return;
    }

    eventTarget
      .removeEventListener(
        'storage',
        onStorage,
      );
    listening = false;
  }

  // Inspect both backing stores before the first mutation. A newer/corrupt
  // payload must never be overwritten by an older client.
  for (
    const target of [
      {
        storage: session,
        key: sessionKey,
      },
      {
        storage: local,
        key: localKey,
      },
    ]
  ) {
    if (
      !target.storage ||
      compatibilityIssue
    ) {
      continue;
    }

    try {
      decodePayload(
        target.storage.getItem(
          target.key,
        ),
      );
    } catch (error) {
      if (
        error instanceof
        DraftStoreVersionError
      ) {
        compatibilityIssue =
          error;
      } else {
        throw error;
      }
    }
  }

  return {
    compatibility() {
      return compatibilityIssue
        ? {
            compatible: false,
            message:
              compatibilityIssue
                .message,
            foundVersion:
              compatibilityIssue
                .foundVersion,
            expectedVersion:
              compatibilityIssue
                .expectedVersion,
            corrupt:
              compatibilityIssue
                .corrupt,
          }
        : {
            compatible: true,
            foundVersion:
              DRAFT_STORAGE_VERSION,
            expectedVersion:
              DRAFT_STORAGE_VERSION,
            corrupt: false,
          };
    },

    isPersistent() {
      return Boolean(
        persistent &&
        local,
      );
    },

    setPersistent(
      nextPersistent,
    ) {
      const next =
        Boolean(
          nextPersistent &&
          local,
        );

      if (
        next === persistent
      ) {
        return this
          .isPersistent();
      }

      if (next) {
        migrateToPersistent();
        try {
          local?.setItem(
            preferenceKey,
            'local',
          );
        } catch {
          // Persistence preference is best-effort.
        }
      } else {
        const {
          current,
        } =
          migrateToSession();

        removeStorage(true);

        try {
          local?.removeItem(
            preferenceKey,
          );
        } catch {
          // Persistence preference is best-effort.
        }

        write(
          current,
          false,
        );
      }

      return this
        .isPersistent();
    },

    subscribe(listener) {
      if (
        typeof listener !==
        'function'
      ) {
        throw new TypeError(
          'Draft listener must be a function',
        );
      }

      listeners.add(
        listener,
      );
      ensureListening();

      return () => {
        listeners.delete(
          listener,
        );
        stopListening();
      };
    },

    list() {
      return Object.entries(
        read(),
      )
        .map(
          (
            [
              id,
              draft,
            ],
          ) => ({
            id,
            ...clone(
              draft,
            ),
          }),
        );
    },

    get(id) {
      const draft =
        read()[
          String(id)
        ];
      return draft
        ? clone(draft)
        : null;
    },

    upsert(
      id,
      draft,
    ) {
      const key =
        String(id);
      const drafts =
        read();
      drafts[key] = {
        ...clone(draft),
        baseUpdatedAt:
          draft.baseUpdatedAt,
        changes:
          clone(
            draft.changes ??
            {},
          ),
        conflict:
          Boolean(
            draft.conflict,
          ),
        updatedAt:
          now(),
      };
      write(drafts);
      return this.get(
        key,
      );
    },

    markConflict(
      id,
      conflict = true,
    ) {
      const key =
        String(id);
      const drafts =
        read();

      if (!drafts[key]) {
        return null;
      }

      const nextConflict =
        Boolean(conflict);

      if (
        Boolean(
          drafts[key]
            .conflict,
        ) === nextConflict
      ) {
        return clone(
          drafts[key],
        );
      }

      drafts[key] = {
        ...drafts[key],
        conflict:
          nextConflict,
        updatedAt:
          now(),
      };
      write(drafts);
      return this.get(
        key,
      );
    },

    remove(id) {
      const drafts =
        read();
      const key =
        String(id);
      const existed =
        Boolean(
          drafts[key],
        );

      if (!existed) {
        return false;
      }

      delete drafts[key];
      write(drafts);
      return true;
    },

    clear() {
      write({});
    },
  };
}
