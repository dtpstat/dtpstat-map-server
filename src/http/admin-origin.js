function canonicalOrigin(
  value,
) {
  const raw =
    String(value ?? '')
      .trim();

  if (!raw) return null;

  let url;
  try {
    url =
      new URL(raw);
  } catch {
    return null;
  }

  if (
    ![
      'http:',
      'https:',
    ].includes(
      url.protocol,
    ) ||
    url.username ||
    url.password ||
    (
      url.pathname !== '/' &&
      url.pathname !== ''
    ) ||
    url.search ||
    url.hash
  ) {
    return null;
  }

  return url.origin;
}

export function normalizeAdminOrigins(
  values = [],
) {
  const result =
    new Set();

  for (const value of values) {
    const origin =
      canonicalOrigin(value);

    if (!origin) {
      throw new Error(
        'ADMIN_ALLOWED_ORIGINS must contain absolute HTTP(S) origins only',
      );
    }

    result.add(origin);
  }

  return result;
}

function dynamicRequestOrigin(
  request,
) {
  const host =
    request.get?.('host') ??
    request.headers?.host;

  if (!host) return null;

  const protocol =
    request.protocol ??
    (
      request.socket
        ?.encrypted
        ? 'https'
        : 'http'
    );

  return canonicalOrigin(
    protocol +
      '://' +
      host,
  );
}

export function requestAdminOrigin(
  request,
) {
  const value =
    request.get?.('origin') ??
    request.headers?.origin;

  return canonicalOrigin(value);
}

export function adminOriginAllowed(
  request,
  allowedOrigins,
  {
    requireOrigin = false,
  } = {},
) {
  const supplied =
    requestAdminOrigin(
      request,
    );

  if (!supplied) {
    return !requireOrigin;
  }

  const configured =
    allowedOrigins instanceof Set
      ? allowedOrigins
      : new Set(
        allowedOrigins ?? [],
      );

  if (
    configured.size > 0
  ) {
    return configured.has(
      supplied,
    );
  }

  const expected =
    dynamicRequestOrigin(
      request,
    );

  return (
    expected !== null &&
    supplied === expected
  );
}

export function createAdminOriginGuard(
  allowedOrigins,
) {
  return (
    request,
    response,
    next,
  ) => {
    const unsafe =
      ![
        'GET',
        'HEAD',
        'OPTIONS',
      ].includes(
        String(
          request.method ??
          '',
        ).toUpperCase(),
      );

    if (
      adminOriginAllowed(
        request,
        allowedOrigins,
        {
          requireOrigin:
            unsafe,
        },
      )
    ) {
      next();
      return;
    }

    response
      .set(
        'Cache-Control',
        'no-store',
      )
      .status(403)
      .json({
        error:
          'Administrative request origin is not allowed',
        code:
          'admin_origin_rejected',
      });
  };
}

export function adminWebSocketOriginAllowed(
  request,
  allowedOrigins,
) {
  const supplied =
    requestAdminOrigin(
      request,
    );

  if (!supplied) {
    return false;
  }

  const configured =
    allowedOrigins instanceof Set
      ? allowedOrigins
      : new Set(
        allowedOrigins ?? [],
      );

  if (
    configured.size > 0
  ) {
    return configured.has(
      supplied,
    );
  }

  const host =
    request.headers?.host;

  if (!host) return false;

  return supplied ===
    canonicalOrigin(
      'http://' + host,
    ) ||
    supplied ===
    canonicalOrigin(
      'https://' + host,
    );
}
