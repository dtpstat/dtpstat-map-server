const SESSION_COOKIE =
  'dtpstat_admin_session';

function parseCookies(header) {
  const cookies = new Map();

  for (
    const part of
    String(header ?? '').split(';')
  ) {
    const separator =
      part.indexOf('=');

    if (separator <= 0) continue;

    const name =
      part.slice(0, separator).trim();

    const value =
      part
        .slice(separator + 1)
        .trim();

    if (!name) continue;

    try {
      cookies.set(
        name,
        decodeURIComponent(value),
      );
    } catch {
      cookies.set(name, value);
    }
  }

  return cookies;
}

export function adminSessionToken(
  request,
) {
  return (
    parseCookies(
      request.headers?.cookie,
    ).get(SESSION_COOKIE) ??
    null
  );
}

export function adminSessionCookieName() {
  return SESSION_COOKIE;
}

export function applyAdminSessionContext(
  request,
  response,
  result,
) {
  request.adminUser =
    result.user;

  request.adminSessionId =
    result.sessionId ?? null;

  request.adminAuthMethod =
    result.authMethod ?? 'basic';

  request.adminSessionExpiresAt =
    result
      .sessionEffectiveExpiresAt ??
    null;

  if (
    result.authMethod ===
      'session' &&
    result
      .sessionEffectiveExpiresAt
  ) {
    response.set(
      'X-DTPStat-Admin-Session-Expires-At',
      result
        .sessionEffectiveExpiresAt,
    );
  }
}
