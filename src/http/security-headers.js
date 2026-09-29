const HSTS_MAX_AGE_SECONDS =
  31_536_000;

export function createTransportSecurityHeaders(
  {
    environment,
  } = {},
) {
  const isProduction =
    environment ===
    'production';

  return (
    request,
    response,
    next,
  ) => {
    if (
      isProduction &&
      request.secure === true
    ) {
      response.set(
        'Strict-Transport-Security',
        `max-age=${HSTS_MAX_AGE_SECONDS}`,
      );
    } else {
      response.removeHeader(
        'Strict-Transport-Security',
      );
    }

    next();
  };
}

export function adminNoStoreHeaders(
  _request,
  response,
  next,
) {
  response.set(
    'Cache-Control',
    'no-store',
  );
  next();
}
