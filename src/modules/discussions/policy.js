export class DiscussionValidationError extends Error {
  constructor(
    message,
    statusCode = 400,
  ) {
    super(message);
    this.name =
      'DiscussionValidationError';
    this.statusCode =
      statusCode;
  }
}

export function normalizeDiscussionId(
  value,
  label = 'id',
) {
  const parsed =
    Number(value);

  if (
    !Number.isSafeInteger(parsed) ||
    parsed <= 0
  ) {
    throw new DiscussionValidationError(
      `${label} must be a positive integer`,
    );
  }

  return parsed;
}

export function normalizeDiscussionMessage(
  payload,
) {
  if (
    !payload ||
    typeof payload !==
      'object' ||
    Array.isArray(payload)
  ) {
    throw new DiscussionValidationError(
      'Discussion payload must be an object',
    );
  }

  const message =
    typeof payload.message ===
      'string'
      ? payload.message.trim()
      : '';

  if (
    message.length < 1 ||
    message.length > 4000
  ) {
    throw new DiscussionValidationError(
      'Discussion message must contain 1-4000 characters',
    );
  }

  return {
    message,
  };
}
