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


export function discussionMentionLogins(
  message,
) {
  const source =
    String(
      message ??
      '',
    ).normalize('NFC');
  const result = [];
  const seen = new Set();
  const pattern =
    /(^|[^\p{L}\p{N}_.-])@([\p{L}\p{N}][\p{L}\p{N}_.-]{0,63})/gu;

  for (
    const match of
    source.matchAll(pattern)
  ) {
    const login =
      match[2]
        .toLocaleLowerCase(
          'en-US',
        );
    if (seen.has(login)) {
      continue;
    }
    seen.add(login);
    result.push(login);
  }

  return result;
}
