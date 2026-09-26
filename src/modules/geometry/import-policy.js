export class GeometryImportSessionError extends Error {
  constructor(
    message,
    statusCode = 409,
    details = null,
  ) {
    super(message);
    this.name =
      'GeometryImportSessionError';
    this.statusCode =
      statusCode;
    this.details =
      details;
  }
}

export function normalizeGeometryImportSessionId(
  value,
) {
  const id =
    Number(value);

  if (
    !Number.isSafeInteger(id) ||
    id <= 0
  ) {
    throw new GeometryImportSessionError(
      'sessionId must be a positive integer',
      400,
    );
  }

  return id;
}

export function normalizeGeometryImportDecisions(
  decisions,
) {
  if (!Array.isArray(decisions)) {
    throw new GeometryImportSessionError(
      'decisions must be an array',
      400,
    );
  }

  const result =
    new Map();

  for (
    const [
      index,
      raw,
    ] of decisions.entries()
  ) {
    if (
      !raw ||
      typeof raw !==
        'object' ||
      Array.isArray(raw)
    ) {
      throw new GeometryImportSessionError(
        `decisions[${index}] must be an object`,
        400,
      );
    }

    const incomingId =
      Number(
        raw.incomingId,
      );

    if (
      !Number.isSafeInteger(
        incomingId,
      ) ||
      incomingId <= 0
    ) {
      throw new GeometryImportSessionError(
        `decisions[${index}].incomingId is invalid`,
        400,
      );
    }

    if (
      ![
        'keep-existing',
        'add-new',
        'replace',
      ].includes(
        raw.action,
      )
    ) {
      throw new GeometryImportSessionError(
        `decisions[${index}].action is invalid`,
        400,
      );
    }

    if (
      result.has(
        incomingId,
      )
    ) {
      throw new GeometryImportSessionError(
        `Duplicate decision for incoming geometry ${incomingId}`,
        400,
      );
    }

    const replaceExistingIds =
      raw.action ===
        'replace'
        ? [
          ...new Set(
            (
              raw
                .replaceExistingIds ??
              []
            ).map(Number),
          ),
        ]
        : [];

    if (
      raw.action ===
        'replace' &&
      (
        replaceExistingIds
          .length < 1 ||
        replaceExistingIds
          .some(
            (id) =>
              !Number
                .isSafeInteger(
                  id,
                ) ||
              id <= 0,
          )
      )
    ) {
      throw new GeometryImportSessionError(
        `decisions[${index}].replaceExistingIds must contain existing geometry ids`,
        400,
      );
    }

    result.set(
      incomingId,
      {
        incomingId,
        action:
          raw.action,
        replaceExistingIds,
      },
    );
  }

  return result;
}
