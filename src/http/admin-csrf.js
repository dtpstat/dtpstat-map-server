export function adminCsrfAllowed(
  request,
  authMethod,
) {
  if (
    authMethod !== 'session' ||
    ['GET', 'HEAD', 'OPTIONS']
      .includes(request.method)
  ) {
    return true;
  }

  const fetchSite =
    request.get?.(
      'sec-fetch-site',
    );

  if (
    fetchSite &&
    ![
      'same-origin',
      'same-site',
      'none',
    ].includes(fetchSite)
  ) {
    return false;
  }

  const origin =
    request.get?.('origin');

  if (!origin) {
    return true;
  }

  try {
    const expected =
      `${request.protocol}://${request.get('host')}`;

    return (
      new URL(origin).origin ===
      expected
    );
  } catch {
    return false;
  }
}
