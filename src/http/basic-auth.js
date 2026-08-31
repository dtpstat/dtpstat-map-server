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
    const authorization = request.get('authorization');
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

    if (
      !matches(username, config.username) ||
      !matches(password, config.password)
    ) {
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
