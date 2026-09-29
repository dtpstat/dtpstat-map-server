const LEGACY_SESSION_COOKIE =
  'dtpstat_admin_session';
const HOST_SESSION_COOKIE =
  '__Host-dtpstat_admin_session';

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

export function adminSessionCookieName(
  options = {},
) {
  return options.secureOnly === true
    ? HOST_SESSION_COOKIE
    : LEGACY_SESSION_COOKIE;
}

export function adminSessionToken(
  request,
  options = {},
) {
  return (
    parseCookies(
      request.headers?.cookie,
    ).get(
      adminSessionCookieName(
        options,
      ),
    ) ??
    null
  );
}

export function adminSessionCookie(
  token,
  maxAgeSeconds,
  options = {},
) {
  const parts = [
    `${adminSessionCookieName(
      options,
    )}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.max(
      0,
      Math.floor(maxAgeSeconds),
    )}`,
  ];

  if (
    options.secureOnly === true ||
    options.secure === true
  ) {
    parts.push('Secure');
  }

  return parts.join('; ');
}

export function clearAdminSessionCookie(
  options = {},
) {
  return adminSessionCookie(
    '',
    0,
    options,
  );
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
    'session';

  request.adminSecuritySettings =
    result.securitySettings ??
    null;

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
