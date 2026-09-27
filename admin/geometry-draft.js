function clone(value) {
  return value === null ||
    value === undefined
    ? value
    : structuredClone(value);
}

function sameValue(
  left,
  right,
) {
  return JSON.stringify(left) ===
    JSON.stringify(right);
}

export function normalizedRevision(
  value,
) {
  if (!value) return null;
  const date =
    new Date(value);
  return Number.isNaN(
    date.valueOf(),
  )
    ? String(value)
    : date.toISOString();
}

export function geometryDraftChanges(
  server,
  edited,
) {
  if (!server || !edited) {
    return {};
  }

  const changes = {};
  const fields = [
    'geometry',
    'displayName',
    'tooltip',
    'tags',
    'isVisible',
    'lineTypeId',
    'lanes',
  ];

  for (const field of fields) {
    if (
      !sameValue(
        server[field] ?? null,
        edited[field] ?? null,
      )
    ) {
      changes[field] =
        clone(
          edited[field] ??
          null,
        );
    }
  }

  return changes;
}

export function applyGeometryDraft(
  server,
  draft,
) {
  if (!server) return null;
  if (!draft) {
    return clone(server);
  }

  return {
    ...clone(server),
    ...clone(
      draft.changes ??
      {},
    ),
    _draft: true,
    _conflict:
      Boolean(
        draft.conflict,
      ),
  };
}

export function geometryDraftIsStale(
  serverUpdatedAt,
  draft,
) {
  if (!draft) return false;

  return (
    normalizedRevision(
      serverUpdatedAt,
    ) !==
    normalizedRevision(
      draft.baseUpdatedAt,
    )
  );
}
