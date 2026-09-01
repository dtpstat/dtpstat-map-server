import crypto from 'node:crypto';

/** @param {string} provided @param {string} expected */
function matches(provided, expected) {
  const providedBytes = Buffer.from(provided, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  return (
    providedBytes.length === expectedBytes.length &&
    crypto.timingSafeEqual(providedBytes, expectedBytes)
  );
}

/**
 * @param {{ username: string, password: string, realm?: string }} config
 */
export function createBasicAuth(config) {
  const realm = config.realm || 'data-import';

  return function basicAuth(request, response, next) {
    if (!verifyBasicAuthorization(request.get('authorization'), config)) {
      response.set(
        'WWW-Authenticate',
        `Basic realm="${realm}", charset="UTF-8"`,
      );
      response.set('Cache-Control', 'no-store');
      response.status(401).json({ error: 'Authentication required' });
      return;
    }

    next();
  };
}

/**
 * Verify an HTTP Authorization header without depending on Express. This is
 * shared by HTTP middleware and the WebSocket upgrade handshake.
 *
 * @param {string | undefined} authorization
 * @param {{ username: string, password: string }} config
 */
export function verifyBasicAuthorization(authorization, config) {
  const [scheme, encoded, extra] = authorization?.split(/\s+/) ?? [];
  let username = '';
  let password = '';
  if (scheme?.toLowerCase() === 'basic' && encoded && !extra) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator >= 0) {
      username = decoded.slice(0, separator);
      password = decoded.slice(separator + 1);
    }
  }
  return matches(username, config.username) && matches(password, config.password);
}
