export function sendAdminAuthorizationError(
  response,
  status,
  error,
  options = {},
) {
  response.set(
    'Cache-Control',
    'no-store',
  );

  if (options.challenge) {
    response.set(
      'WWW-Authenticate',
      'Basic realm="dtpstat-admin", charset="UTF-8"',
    );
  }

  if (
    options.retryAfterSeconds
  ) {
    response.set(
      'Retry-After',
      String(
        options.retryAfterSeconds,
      ),
    );
  }

  response
    .status(status)
    .json({
      error,
      ...(options.code
        ? {
          code:
            options.code,
        }
        : {}),
      ...(options.retryAfterSeconds
        ? {
          retryAfterSeconds:
            options.retryAfterSeconds,
        }
        : {}),
    });
}

/**
 * Map non-success authentication states onto their stable admin HTTP contract.
 * Returns true when a response was sent.
 */
export function respondAdminAuthenticationFailure(
  response,
  result,
  {
    challengeOnMissing = false,
  } = {},
) {
  if (
    result.status ===
      'missing' ||
    result.status ===
      'invalid' ||
    result.status ===
      'expired'
  ) {
    sendAdminAuthorizationError(
      response,
      401,
      'Authentication required',
      {
        challenge:
          challengeOnMissing,
      },
    );

    return true;
  }

  if (
    result.status ===
    'ip-blocked'
  ) {
    sendAdminAuthorizationError(
      response,
      403,
      'This IP address is blocked by an administrator',
    );

    return true;
  }

  if (
    result.status ===
    'ip-locked'
  ) {
    sendAdminAuthorizationError(
      response,
      429,
      'Too many failed login attempts from this IP address',
      {
        retryAfterSeconds:
          result.retryAfterSeconds,
      },
    );

    return true;
  }

  if (
    result.status ===
    'blocked'
  ) {
    sendAdminAuthorizationError(
      response,
      403,
      'Administrator account is blocked',
      {
        retryAfterSeconds:
          result.retryAfterSeconds,
      },
    );

    return true;
  }

  if (
    result.status ===
    'locked'
  ) {
    sendAdminAuthorizationError(
      response,
      423,
      'Administrator account is temporarily locked',
      {
        retryAfterSeconds:
          result.retryAfterSeconds,
      },
    );

    return true;
  }

  if (
    result.status !==
    'success'
  ) {
    sendAdminAuthorizationError(
      response,
      401,
      'Invalid username or password',
      {
        challenge: true,
      },
    );

    return true;
  }

  return false;
}
